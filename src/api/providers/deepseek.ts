import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import {
	ApiHandlerOptions,
	DeepSeekModelId,
	deepSeekModels,
	deepSeekDefaultModelId,
	ModelInfo,
} from "../../shared/api"
import { ApiHandler } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

// Extend OpenAI's CompletionUsage type to include DeepSeek's cache fields
interface DeepSeekCompletionUsage extends OpenAI.CompletionUsage {
	prompt_cache_hit_tokens?: number
	prompt_cache_miss_tokens?: number
}

export class DeepSeekHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private isBeta: boolean

	constructor(options: ApiHandlerOptions) {
		if (!options.deepSeekApiKey) {
			throw new Error("API key is required for DeepSeek")
		}
		this.options = options
		
		const baseUrl = this.options.deepSeekBaseUrl || "https://api.deepseek.com"
		this.isBeta = baseUrl.includes("/beta")
		
		this.client = new OpenAI({
			baseURL: baseUrl + "/v1",
			apiKey: this.options.deepSeekApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await this.client.chat.completions.create({
			model: "deepseek-chat", // Always use deepseek-chat as the model ID
			messages: openAiMessages,
			max_tokens: this.isBeta ? 8192 : 4096, // Set max tokens based on endpoint
			temperature: 0,
			stream: true,
		})

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// DeepSeek provides cache hit status in usage
			if (chunk.usage) {
				const usage = chunk.usage as DeepSeekCompletionUsage
				yield {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
					cacheReadTokens: usage.prompt_cache_hit_tokens || 0,
					cacheWriteTokens: usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}

	getModel(): { id: DeepSeekModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in deepSeekModels) {
			const id = modelId as DeepSeekModelId
			return { id, info: deepSeekModels[id] }
		}
		return { id: deepSeekDefaultModelId, info: deepSeekModels[deepSeekDefaultModelId] }
	}
}
