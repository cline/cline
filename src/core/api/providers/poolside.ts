import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, OpenAiCompatibleModelInfo, poolsideModelInfoSaneDefaults } from "@shared/api"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface PoolsideHandlerOptions extends CommonApiHandlerOptions {
	poolsideApiKey?: string
	poolsideBaseUrl?: string
	poolsideModelId?: string
	poolsideModelInfo?: OpenAiCompatibleModelInfo
}

export class PoolsideHandler implements ApiHandler {
	private options: PoolsideHandlerOptions
	private client: OpenAI | undefined

	constructor(options: PoolsideHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.poolsideApiKey) {
				throw new Error("Poolside API key is required")
			}
			if (!this.options.poolsideBaseUrl) {
				throw new Error("Poolside base URL is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: this.options.poolsideBaseUrl,
					apiKey: this.options.poolsideApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Poolside client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.poolsideModelId ?? ""

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const temperature: number | undefined =
			this.options.poolsideModelInfo?.temperature ?? poolsideModelInfoSaneDefaults.temperature
		let maxTokens: number | undefined

		if (this.options.poolsideModelInfo?.maxTokens && this.options.poolsideModelInfo.maxTokens > 0) {
			maxTokens = Number(this.options.poolsideModelInfo.maxTokens)
		} else {
			maxTokens = undefined
		}

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			temperature,
			max_tokens: maxTokens,
			stream: true,
			stream_options: { include_usage: true },
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
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
		return {
			id: this.options.poolsideModelId ?? "",
			info: this.options.poolsideModelInfo ?? poolsideModelInfoSaneDefaults,
		}
	}
}
