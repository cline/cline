import { type AtlascloudModelId, atlascloudDefaultModelId, atlascloudModels, type ModelInfo } from "@shared/api"
import type OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import type { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import type { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface AtlascloudHandlerOptions extends CommonApiHandlerOptions {
	atlascloudApiKey?: string
	apiModelId?: string
}

export class AtlascloudHandler implements ApiHandler {
	private options: AtlascloudHandlerOptions
	private client: OpenAI | undefined

	constructor(options: AtlascloudHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.atlascloudApiKey) {
				throw new Error("Atlas Cloud API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: "https://api.atlascloud.ai/v1",
					apiKey: this.options.atlascloudApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Atlas Cloud client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()

		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const modelId = model.id.toLowerCase()

		if (modelId.includes("deepseek") || modelId.includes("qwen3")) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		const toolCallProcessor = new ToolCallProcessor()
		const stream = await client.chat.completions.create({
			model: this.getModel().id,
			messages: openAiMessages,
			temperature: model.info.temperature ?? 0,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		})

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta

			// Atlas Cloud reasoning models stream chain-of-thought in `reasoning_content`.
			const reasoningContent = (delta as { reasoning_content?: string })?.reasoning_content
			if (reasoningContent) {
				yield {
					type: "reasoning",
					reasoning: reasoningContent,
				}
			}

			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			if (delta?.tool_calls) {
				yield* toolCallProcessor.processToolCallDeltas(delta.tool_calls)
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in atlascloudModels) {
			const id = modelId as AtlascloudModelId
			return { id, info: atlascloudModels[id] }
		}
		return {
			id: atlascloudDefaultModelId,
			info: atlascloudModels[atlascloudDefaultModelId],
		}
	}
}
