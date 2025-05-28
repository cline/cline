import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, GroqModelId, ModelInfo, groqDefaultModelId, groqModels } from "@shared/api"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export class GroqHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.groq.com/openai/v1",
			apiKey: this.options.groqApiKey,
		})
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens)
		yield {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost,
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await this.client.chat.completions.create({
			model: model.id,
			max_tokens: model.info.maxTokens,
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
				yield* this.yieldUsage(model.info, chunk.usage)
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId

		// First check if we have dynamic model info from API
		const dynamicModelInfo = this.options.groqModelInfo
		if (modelId && dynamicModelInfo) {
			return { id: modelId, info: dynamicModelInfo }
		}

		// Fall back to static models
		if (modelId && modelId in groqModels) {
			const id = modelId as GroqModelId
			return { id, info: groqModels[id] }
		}

		// Default fallback
		return {
			id: groqDefaultModelId,
			info: groqModels[groqDefaultModelId],
		}
	}
}
