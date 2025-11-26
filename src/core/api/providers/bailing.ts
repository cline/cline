import { BailingModelId, bailingDefaultModelId, bailingModels, ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from ".."
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface BailingHandlerOptions extends CommonApiHandlerOptions {
	bailingApiKey?: string
	apiModelId?: string
}

export class BailingHandler implements ApiHandler {
	private options: BailingHandlerOptions
	private client: OpenAI | undefined
	
	constructor(options: BailingHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.bailingApiKey) {
				throw new Error("Bailing API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://api.tbox.cn/api/llm/v1",
					apiKey: this.options.bailingApiKey,
					fetch, // Use configured fetch with proxy support
				})
			} catch (error: any) {
				throw new Error(`Error creating Bailing client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: BailingModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in bailingModels) {
			const id = modelId as BailingModelId
			return { id, info: bailingModels[id] }
		}
		return {
			id: bailingDefaultModelId,
			info: bailingModels[bailingDefaultModelId],
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		
		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: model.info.maxTokens,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			temperature: model.info.temperature ?? 0,
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
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}
}

