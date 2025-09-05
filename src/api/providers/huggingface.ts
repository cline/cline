import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import { getHuggingFaceModels, getCachedHuggingFaceModels } from "./fetchers/huggingface"
import { handleOpenAIError } from "./utils/openai-error-handler"

export class HuggingFaceHandler extends BaseProvider implements SingleCompletionHandler {
	private client: OpenAI
	private options: ApiHandlerOptions
	private modelCache: ModelRecord | null = null
	private readonly providerName = "HuggingFace"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		if (!this.options.huggingFaceApiKey) {
			throw new Error("Hugging Face API key is required")
		}

		this.client = new OpenAI({
			baseURL: "https://router.huggingface.co/v1",
			apiKey: this.options.huggingFaceApiKey,
			defaultHeaders: DEFAULT_HEADERS,
		})

		// Try to get cached models first
		this.modelCache = getCachedHuggingFaceModels()

		// Fetch models asynchronously
		this.fetchModels()
	}

	private async fetchModels() {
		try {
			this.modelCache = await getHuggingFaceModels()
		} catch (error) {
			console.error("Failed to fetch HuggingFace models:", error)
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelId = this.options.huggingFaceModelId || "meta-llama/Llama-3.3-70B-Instruct"
		const temperature = this.options.modelTemperature ?? 0.7

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
		}

		// Add max_tokens if specified
		if (this.options.includeMaxTokens && this.options.modelMaxTokens) {
			params.max_tokens = this.options.modelMaxTokens
		}

		let stream
		try {
			stream = await this.client.chat.completions.create(params)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

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

	async completePrompt(prompt: string): Promise<string> {
		const modelId = this.options.huggingFaceModelId || "meta-llama/Llama-3.3-70B-Instruct"

		try {
			const response = await this.client.chat.completions.create({
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			})

			return response.choices[0]?.message.content || ""
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}

	override getModel() {
		const modelId = this.options.huggingFaceModelId || "meta-llama/Llama-3.3-70B-Instruct"

		// Try to get model info from cache
		const modelInfo = this.modelCache?.[modelId]

		if (modelInfo) {
			return {
				id: modelId,
				info: modelInfo,
			}
		}

		// Fallback to default values if model not found in cache
		return {
			id: modelId,
			info: {
				maxTokens: 8192,
				contextWindow: 131072,
				supportsImages: false,
				supportsPromptCache: false,
			},
		}
	}
}
