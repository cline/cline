import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { BasetenModelId, ModelInfo, basetenDefaultModelId, basetenModels } from "@shared/api"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface BasetenHandlerOptions {
	basetenApiKey?: string
	basetenModelId?: string
	basetenModelInfo?: ModelInfo
	apiModelId?: string // For backward compatibility
}

export class BasetenHandler implements ApiHandler {
	private options: BasetenHandlerOptions
	private client: OpenAI | undefined

	constructor(options: BasetenHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.basetenApiKey) {
				throw new Error("Baseten API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://inference.baseten.co/v1",
					apiKey: this.options.basetenApiKey,
				})
			} catch (error) {
				throw new Error(`Error creating Baseten client: ${error.message}`)
			}
		}
		return this.client
	}

	getModel(): { id: BasetenModelId; info: ModelInfo } {
		const modelId = (this.options.basetenModelId || this.options.apiModelId || basetenDefaultModelId) as BasetenModelId
		const modelInfo = this.options.basetenModelInfo || basetenModels[modelId]

		if (!modelInfo) {
			throw new Error(`Unknown Baseten model: ${modelId}`)
		}

		return { id: modelId, info: modelInfo }
	}

	private getOptimalMaxTokens(model: { id: BasetenModelId; info: ModelInfo }): number {
		// Use model-specific max tokens if available, otherwise use default
		return model.info.maxTokens || 8192
	}

	private async *yieldUsage(modelInfo: ModelInfo, usage: any): ApiStream {
		if (usage.prompt_tokens || usage.completion_tokens) {
			const cost = calculateApiCostOpenAI(modelInfo, usage.prompt_tokens || 0, usage.completion_tokens || 0)

			yield {
				type: "usage",
				inputTokens: usage.prompt_tokens || 0,
				outputTokens: usage.completion_tokens || 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: cost,
			}
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const maxTokens = this.getOptimalMaxTokens(model)

		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: maxTokens,
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
}
