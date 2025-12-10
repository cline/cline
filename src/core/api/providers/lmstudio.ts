import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import type { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface LmStudioHandlerOptions extends CommonApiHandlerOptions {
	lmStudioBaseUrl?: string
	lmStudioModelId?: string
	lmStudioMaxTokens?: string
}

export class LmStudioHandler implements ApiHandler {
	private options: LmStudioHandlerOptions
	private client: OpenAI | undefined

	constructor(options: LmStudioHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			try {
				this.client = new OpenAI({
					// Docs on the new v0 api endpoint: https://lmstudio.ai/docs/app/api/endpoints/rest
					baseURL: new URL("api/v0", this.options.lmStudioBaseUrl || "http://localhost:1234").toString(),
					apiKey: "noop",
					fetch, // Use configured fetch with proxy support
				})
			} catch (error) {
				throw new Error(`Error creating LM Studio client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry({ retryAllErrors: true })
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		try {
			const stream = await client.chat.completions.create({
				model: this.getModel().id,
				messages: openAiMessages,
				stream: true,
				stream_options: { include_usage: true },
				max_completion_tokens: this.options.lmStudioMaxTokens ? Number(this.options.lmStudioMaxTokens) : undefined,
				...getOpenAIToolParams(tools),
			})

			const toolCallProcessor = new ToolCallProcessor()

			for await (const chunk of stream) {
				const choice = chunk.choices[0]
				const delta = choice?.delta
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}
				if (delta && "reasoning_content" in delta && delta.reasoning_content) {
					yield {
						type: "reasoning",
						reasoning: (delta.reasoning_content as string | undefined) || "",
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
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					}
				}
			}
		} catch {
			// LM Studio doesn't return an error code/body for now
			throw new Error(
				"Please check the LM Studio developer logs to debug what went wrong. You may need to load the model with a larger context length to work with Cline's prompts. Alternatively, try enabling Compact Prompt in your settings when working with a limited context window.",
			)
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const info = { ...openAiModelInfoSaneDefaults }
		const maxTokens = Number(this.options.lmStudioMaxTokens)
		if (!Number.isNaN(maxTokens)) {
			info.contextWindow = maxTokens
		}
		return {
			id: this.options.lmStudioModelId || "",
			info,
		}
	}
}
