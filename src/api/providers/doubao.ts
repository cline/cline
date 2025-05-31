import { ApiHandler } from ".."
import { ApiHandlerOptions, doubaoDefaultModelId, DoubaoModelId, doubaoModels, ModelInfo } from "@shared/api"
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { withRetry } from "../retry"

export class DoubaoHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://ark.cn-beijing.volces.com/api/v3/",
			apiKey: this.options.doubaoApiKey,
		})
	}

	getModel(): { id: DoubaoModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in doubaoModels) {
			const id = modelId as DoubaoModelId
			return { id, info: doubaoModels[id] }
		}
		return {
			id: doubaoDefaultModelId,
			info: doubaoModels[doubaoDefaultModelId],
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]
		const stream = await this.client.chat.completions.create({
			model: model.id,
			max_completion_tokens: model.info.maxTokens,
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
					cacheReadTokens: chunk.usage.prompt_cache_hit_tokens || 0,
					// @ts-ignore-next-line
					cacheWriteTokens: chunk.usage.prompt_cache_miss_tokens || 0,
				}
			}
		}
	}
}
