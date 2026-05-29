import { ModelInfo, openAiModelInfoSaneDefaults, rodiumaiDefaultModelId, rodiumaiDefaultModelInfo, rodiumaiModels } from "@shared/api"
import { calculateApiCostOpenAI } from "@utils/cost"
import OpenAI from "openai"
import { ClineStorageMessage } from "@/shared/messages/content"
import { createOpenAIClient } from "@/shared/net"
import { ApiHandler, CommonApiHandlerOptions } from "../index"
import { withRetry } from "../retry"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

interface RodiumaiHandlerOptions extends CommonApiHandlerOptions {
	rodiumaiApiKey?: string
	rodiumaiBaseUrl?: string
	rodiumaiModelId?: string
	rodiumaiModelInfo?: ModelInfo
}

interface RodiumaiUsage extends OpenAI.CompletionUsage {
	prompt_tokens_details?: {
		caching_tokens?: number
		cached_tokens?: number
	}
}

export class RodiumaiHandler implements ApiHandler {
	private options: RodiumaiHandlerOptions
	private client: OpenAI | undefined

	constructor(options: RodiumaiHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.rodiumaiApiKey) {
				throw new Error("RodiumAI API key is required")
			}
			try {
				this.client = createOpenAIClient({
					baseURL: this.options.rodiumaiBaseUrl || "https://api.rodiumai.io/v1",
					apiKey: this.options.rodiumaiApiKey,
				})
			} catch (error: any) {
				throw new Error(`Error creating RodiumAI client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		const stream = await client.chat.completions.create({
			model: model.id,
			max_tokens: model.info.maxTokens || undefined,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			temperature: 0,
			stream: true,
			stream_options: { include_usage: true },
		})

		let lastUsage: OpenAI.CompletionUsage | undefined
		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}
			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			const usage = lastUsage as RodiumaiUsage
			const inputTokens = usage.prompt_tokens || 0
			const outputTokens = usage.completion_tokens || 0
			const cacheWriteTokens = usage.prompt_tokens_details?.caching_tokens || undefined
			const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens || undefined
			const totalCost = calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				cacheWriteTokens,
				cacheReadTokens,
				totalCost,
			}
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.rodiumaiModelId
		const modelInfo = this.options.rodiumaiModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		if (modelId && rodiumaiModels[modelId as keyof typeof rodiumaiModels]) {
			return { id: modelId, info: rodiumaiModels[modelId as keyof typeof rodiumaiModels] }
		}
		if (modelId) {
			return { id: modelId, info: openAiModelInfoSaneDefaults }
		}
		return { id: rodiumaiDefaultModelId, info: rodiumaiDefaultModelInfo }
	}
}
