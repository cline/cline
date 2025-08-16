import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from ".."
import { ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { convertToOpenAiMessages } from "@api/transform/openai-format"
import { ApiStream } from "@api/transform/stream"

interface FeatherlessHandlerOptions {
	featherlessApiKey?: string
	apiModelId?: string
}

export class FeatherlessHandler implements ApiHandler {
	private options: FeatherlessHandlerOptions
	private client: OpenAI | undefined

	constructor(options: FeatherlessHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.featherlessApiKey) {
				throw new Error("Featherless API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.featherless.ai/v1",
					apiKey: this.options.featherlessApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating Featherless client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const modelId = this.options.apiModelId ?? ""

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0,
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
					// @ts-ignore-next-line
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.options.apiModelId ?? "",
			info: openAiModelInfoSaneDefaults,
		}
	}
}
