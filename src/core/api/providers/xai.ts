import { ModelInfo, XAIModelId, xaiDefaultModelId, xaiModels } from "@shared/api"
import { shouldSkipReasoningForModel } from "@utils/model-utils"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ChatCompletionReasoningEffort } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface XAIHandlerOptions extends CommonApiHandlerOptions {
	xaiApiKey?: string
	reasoningEffort?: string
	apiModelId?: string
}

export class XAIHandler implements ApiHandler {
	private options: XAIHandlerOptions
	private client: OpenAI | undefined

	constructor(options: XAIHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.xaiApiKey) {
				throw new Error("xAI API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.x.ai/v1",
					apiKey: this.options.xaiApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error: any) {
				throw new Error(`Error creating xAI client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.getModel().id
		const modelInfo = this.getModel().info

		// ensure reasoning effort is either "low" or "high" for grok-3-mini
		let reasoningEffort: ChatCompletionReasoningEffort | undefined
		if (modelId.includes("3-mini")) {
			let reasoningEffort = this.options.reasoningEffort
			if (reasoningEffort && !["low", "high"].includes(reasoningEffort)) {
				reasoningEffort = undefined
			}
		}

		// Prepare messages with prompt caching if supported
		const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Apply prompt caching for models that support it
		// XAI's prompt caching follows OpenAI's cache_control pattern
		if (modelInfo.supportsPromptCache) {
			// Cache the system prompt
			chatMessages[0] = {
				role: "system",
				content: [
					{
						type: "text",
						text: systemPrompt,
						// @ts-ignore - cache_control is an extension field
						cache_control: { type: "ephemeral" },
					},
				],
			}

			// Cache the last two user messages for conversation continuity
			const lastTwoUserMessages = chatMessages.filter((msg) => msg.role === "user").slice(-2)
			lastTwoUserMessages.forEach((msg) => {
				if (typeof msg.content === "string") {
					msg.content = [{ type: "text", text: msg.content }]
				}
				if (Array.isArray(msg.content)) {
					// Find the last text part to add cache control
					let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

					if (!lastTextPart) {
						lastTextPart = { type: "text", text: "..." }
						msg.content.push(lastTextPart)
					}
					// @ts-ignore - cache_control is an extension field
					lastTextPart["cache_control"] = { type: "ephemeral" }
				}
			})
		}

		const stream = await client.chat.completions.create({
			model: modelId,
			max_completion_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: chatMessages,
			stream: true,
			stream_options: { include_usage: true },
			reasoning_effort: reasoningEffort,
			...getOpenAIToolParams(tools),
		})

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (delta && "reasoning_content" in delta && delta.reasoning_content) {
				// Skip reasoning content for Grok 4 models since it only displays "thinking" without providing useful information
				if (!shouldSkipReasoningForModel(modelId)) {
					yield {
						type: "reasoning",
						// @ts-ignore-next-line
						reasoning: delta.reasoning_content,
					}
				}
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					// @ts-ignore-next-line
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: XAIModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in xaiModels) {
			const id = modelId as XAIModelId
			return { id, info: xaiModels[id] }
		}
		return {
			id: xaiDefaultModelId,
			info: xaiModels[xaiDefaultModelId],
		}
	}
}
