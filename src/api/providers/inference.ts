import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"

export type InferenceModelId = string

export interface InferenceModelResponse {
	data: Array<{
		id: string
		name: string
		context_length: number
		architecture: {
			modality: string
			tokenizer: string
			instruct_type: string | null
		}
		pricing: {
			prompt: string
			completion: string
			image: string
			request: string
		}
		top_provider: {
			context_length: number
			max_completion_tokens: number
			is_moderated: boolean
		}
		per_request_limits: any
	}>
}

// Default models to use if the API call fails
export const defaultInferenceModels: Record<string, ModelInfo> = {
	"meta-llama/llama-3.1-8b-instruct/fp-16": {
		maxTokens: 16384,
		contextWindow: 16384,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.00000003 * 1000000, // Convert from per-token to per-million tokens
		outputPrice: 0.00000003 * 1000000,
		description: "Meta's Llama 3.1 8B Instruct model",
	},
	"meta-llama/llama-3.1-70b-instruct/fp-16": {
		maxTokens: 16384,
		contextWindow: 16384,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0000004 * 1000000,
		outputPrice: 0.0000004 * 1000000,
		description: "Meta's Llama 3.1 70B Instruct model",
	},
}

export const inferenceDefaultModelId: InferenceModelId = "meta-llama/llama-3.1-8b-instruct/fp-16"

export class InferenceHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private inferenceModels: Record<string, ModelInfo> = defaultInferenceModels
	private defaultModel: { id: InferenceModelId; info: ModelInfo }

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.inference.net/v1",
			apiKey: this.options.inferenceApiKey || process.env.INFERENCE_API_KEY,
		})

		this.defaultModel = {
			id: inferenceDefaultModelId,
			info: defaultInferenceModels[inferenceDefaultModelId],
		}

		// Fetch available models in the background
		this.fetchAvailableModels()
	}

	private async fetchAvailableModels() {
		try {
			const response = await fetch("https://relay.inference.net/openrouter/v1/models")
			if (!response.ok) {
				console.error("Failed to fetch Inference.net models:", response.statusText)
				return
			}

			const data = (await response.json()) as InferenceModelResponse

			// Convert the API response to our ModelInfo format
			const models: Record<string, ModelInfo> = {}

			for (const model of data.data) {
				// Convert pricing from per-token to per-million tokens for consistency with other providers
				const inputPrice = parseFloat(model.pricing.prompt) * 1000000
				const outputPrice = parseFloat(model.pricing.completion) * 1000000

				const supportsImages = model.architecture.modality.includes("image")

				models[model.id] = {
					maxTokens: model.top_provider.max_completion_tokens,
					contextWindow: model.context_length,
					supportsImages,
					supportsPromptCache: false,
					inputPrice,
					outputPrice,
					description: `${model.name} (${supportsImages ? "supports images, " : ""}${model.context_length} context window)`,
				}
			}

			// Update our models if we got some valid ones
			if (Object.keys(models).length > 0) {
				this.inferenceModels = models
			}
		} catch (error) {
			console.error("Error fetching Inference.net models:", error)
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const stream = await this.client.chat.completions.create({
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			temperature: 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
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

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				}
			}
		}
	}

	getModel(): { id: InferenceModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in this.inferenceModels) {
			return {
				id: modelId as InferenceModelId,
				info: this.inferenceModels[modelId],
			}
		}
		return this.defaultModel
	}
}
