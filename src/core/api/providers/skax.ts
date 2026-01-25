import { OpenAiCompatibleModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { getOpenAIToolParams, ToolCallProcessor } from "../transform/tool-call-processor"

interface SkaxHandlerOptions extends CommonApiHandlerOptions {
	skaxApiKey?: string
	skaxBaseUrl?: string
	skaxModelId?: string
	skaxModelInfo?: OpenAiCompatibleModelInfo
}

export class SkaxHandler implements ApiHandler {
	private options: SkaxHandlerOptions
	private client: OpenAI | undefined

	constructor(options: SkaxHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.skaxApiKey) {
				throw new Error("SKAX API key is required")
			}
			this.client = new OpenAI({
				baseURL: this.options.skaxBaseUrl || "https://guest-api.sktax.chat/v1",
				apiKey: this.options.skaxApiKey,
				fetch,
			})
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.skaxModelId ?? ""

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const temperature = this.options.skaxModelInfo?.temperature ?? openAiModelInfoSaneDefaults.temperature
		const maxTokens = this.options.skaxModelInfo?.maxTokens ?? undefined

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			stream: true,
			stream_options: { include_usage: true },
			...getOpenAIToolParams(tools),
		})

		const toolCallProcessor = new ToolCallProcessor()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
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
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					cacheWriteTokens: 0,
				}
			}
		}
	}

	getModel() {
		return {
			id: this.options.skaxModelId ?? "",
			info: this.options.skaxModelInfo ?? openAiModelInfoSaneDefaults,
		}
	}
}
