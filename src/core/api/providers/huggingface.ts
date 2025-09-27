import { Anthropic } from "@anthropic-ai/sdk"
import { HuggingFaceModelId, huggingFaceDefaultModelId, huggingFaceModels, ModelInfo } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface HuggingFaceHandlerOptions extends CommonApiHandlerOptions {
	huggingFaceApiKey?: string
	huggingFaceModelId?: string
	huggingFaceModelInfo?: ModelInfo
}

export class HuggingFaceHandler implements ApiHandler {
	private options: HuggingFaceHandlerOptions
	private client: OpenAI | undefined
	private cachedModel: { id: HuggingFaceModelId; info: ModelInfo } | undefined

	constructor(options: HuggingFaceHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.huggingFaceApiKey) {
				throw new Error("Hugging Face API key is required")
			}

			try {
				this.client = new OpenAI({
					baseURL: "https://router.huggingface.co/v1",
					apiKey: this.options.huggingFaceApiKey,
					defaultHeaders: {
						"User-Agent": "Cline/1.0",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating Hugging Face client: ${error.message}`)
			}
		}
		return this.client
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		if (!usage) {
			return
		}

		const inputTokens = usage.prompt_tokens || 0
		const outputTokens = usage.completion_tokens || 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens)

		const usageData = {
			type: "usage" as const,
			inputTokens: inputTokens,
			outputTokens: outputTokens,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: totalCost,
		}

		yield usageData
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		try {
			const client = this.ensureClient()
			const model = this.getModel()

			const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
				{ role: "system", content: systemPrompt },
				...convertToOpenAiMessages(messages),
			]

			const requestParams = {
				model: model.id,
				max_tokens: model.info.maxTokens,
				messages: openAiMessages,
				stream: true,
				stream_options: { include_usage: true },
				temperature: 0,
			}

			const stream = (await client.chat.completions.create(requestParams)) as any

			let _chunkCount = 0
			let _totalContent = ""

			for await (const chunk of stream) {
				_chunkCount++
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					_totalContent += delta.content

					yield {
						type: "text",
						text: delta.content,
					}
				}

				if (chunk.usage) {
					yield* this.yieldUsage(model.info, chunk.usage)
				}
			}
		} catch (error: any) {
			throw error
		}
	}

	getModel(): { id: HuggingFaceModelId; info: ModelInfo } {
		// Return cached model if available
		if (this.cachedModel) {
			return this.cachedModel
		}

		const modelId = this.options.huggingFaceModelId

		// List all available models for debugging
		const _availableModels = Object.keys(huggingFaceModels)
		let result: { id: HuggingFaceModelId; info: ModelInfo }

		if (modelId && modelId in huggingFaceModels) {
			const id = modelId as HuggingFaceModelId
			const modelInfo = huggingFaceModels[id]
			result = { id, info: modelInfo }
		} else {
			const defaultInfo = huggingFaceModels[huggingFaceDefaultModelId]
			result = {
				id: huggingFaceDefaultModelId,
				info: defaultInfo,
			}
		}

		// Cache the result for future calls
		this.cachedModel = result

		return result
	}
}
