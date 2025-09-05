import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	OPENROUTER_DEFAULT_PROVIDER_NAME,
	OPEN_ROUTER_PROMPT_CACHING_MODELS,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
} from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStreamChunk } from "../transform/stream"
import { convertToR1Format } from "../transform/r1-format"
import { addCacheBreakpoints as addAnthropicCacheBreakpoints } from "../transform/caching/anthropic"
import { addCacheBreakpoints as addGeminiCacheBreakpoints } from "../transform/caching/gemini"
import type { OpenRouterReasoningParams } from "../transform/reasoning"
import { getModelParams } from "../transform/model-params"

import { getModels } from "./fetchers/modelCache"
import { getModelEndpoints } from "./fetchers/modelEndpointCache"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler } from "../index"
import { handleOpenAIError } from "./utils/openai-error-handler"

// Image generation types
interface ImageGenerationResponse {
	choices?: Array<{
		message?: {
			content?: string
			images?: Array<{
				type?: string
				image_url?: {
					url?: string
				}
			}>
		}
	}>
	error?: {
		message?: string
		type?: string
		code?: string
	}
}

export interface ImageGenerationResult {
	success: boolean
	imageData?: string
	imageFormat?: string
	error?: string
}

// Add custom interface for OpenRouter params.
type OpenRouterChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParams & {
	transforms?: string[]
	include_reasoning?: boolean
	// https://openrouter.ai/docs/use-cases/reasoning-tokens
	reasoning?: OpenRouterReasoningParams
}

// See `OpenAI.Chat.Completions.ChatCompletionChunk["usage"]`
// `CompletionsAPI.CompletionUsage`
// See also: https://openrouter.ai/docs/use-cases/usage-accounting
interface CompletionUsage {
	completion_tokens?: number
	completion_tokens_details?: {
		reasoning_tokens?: number
	}
	prompt_tokens?: number
	prompt_tokens_details?: {
		cached_tokens?: number
	}
	total_tokens?: number
	cost?: number
	cost_details?: {
		upstream_inference_cost?: number
	}
}

export class OpenRouterHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: OpenAI
	protected models: ModelRecord = {}
	protected endpoints: ModelRecord = {}
	private readonly providerName = "OpenRouter"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseURL = this.options.openRouterBaseUrl || "https://openrouter.ai/api/v1"
		const apiKey = this.options.openRouterApiKey ?? "not-provided"

		this.client = new OpenAI({ baseURL, apiKey, defaultHeaders: DEFAULT_HEADERS })
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
	): AsyncGenerator<ApiStreamChunk> {
		const model = await this.fetchModel()

		let { id: modelId, maxTokens, temperature, topP, reasoning } = model

		// OpenRouter sends reasoning tokens by default for Gemini 2.5 Pro
		// Preview even if you don't request them. This is not the default for
		// other providers (including Gemini), so we need to explicitly disable
		// i We should generalize this using the logic in `getModelParams`, but
		// this is easier for now.
		if (
			(modelId === "google/gemini-2.5-pro-preview" || modelId === "google/gemini-2.5-pro") &&
			typeof reasoning === "undefined"
		) {
			reasoning = { exclude: true }
		}

		// Convert Anthropic messages to OpenAI format.
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// DeepSeek highly recommends using user instead of system role.
		if (modelId.startsWith("deepseek/deepseek-r1") || modelId === "perplexity/sonar-reasoning") {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		// https://openrouter.ai/docs/features/prompt-caching
		// TODO: Add a `promptCacheStratey` field to `ModelInfo`.
		if (OPEN_ROUTER_PROMPT_CACHING_MODELS.has(modelId)) {
			if (modelId.startsWith("google")) {
				addGeminiCacheBreakpoints(systemPrompt, openAiMessages)
			} else {
				addAnthropicCacheBreakpoints(systemPrompt, openAiMessages)
			}
		}

		const transforms = (this.options.openRouterUseMiddleOutTransform ?? true) ? ["middle-out"] : undefined

		// https://openrouter.ai/docs/transforms
		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			...(maxTokens && maxTokens > 0 && { max_tokens: maxTokens }),
			temperature,
			top_p: topP,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			// Only include provider if openRouterSpecificProvider is not "[default]".
			...(this.options.openRouterSpecificProvider &&
				this.options.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME && {
					provider: {
						order: [this.options.openRouterSpecificProvider],
						only: [this.options.openRouterSpecificProvider],
						allow_fallbacks: false,
					},
				}),
			...(transforms && { transforms }),
			...(reasoning && { reasoning }),
		}

		let stream
		try {
			stream = await this.client.chat.completions.create(completionParams)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

		let lastUsage: CompletionUsage | undefined = undefined

		for await (const chunk of stream) {
			// OpenRouter returns an error object instead of the OpenAI SDK throwing an error.
			if ("error" in chunk) {
				const error = chunk.error as { message?: string; code?: number }
				console.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
				throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
			}

			const delta = chunk.choices[0]?.delta

			if ("reasoning" in delta && delta.reasoning && typeof delta.reasoning === "string") {
				yield { type: "reasoning", text: delta.reasoning }
			}

			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield {
				type: "usage",
				inputTokens: lastUsage.prompt_tokens || 0,
				outputTokens: lastUsage.completion_tokens || 0,
				cacheReadTokens: lastUsage.prompt_tokens_details?.cached_tokens,
				reasoningTokens: lastUsage.completion_tokens_details?.reasoning_tokens,
				totalCost: (lastUsage.cost_details?.upstream_inference_cost || 0) + (lastUsage.cost || 0),
			}
		}
	}

	public async fetchModel() {
		const [models, endpoints] = await Promise.all([
			getModels({ provider: "openrouter" }),
			getModelEndpoints({
				router: "openrouter",
				modelId: this.options.openRouterModelId,
				endpoint: this.options.openRouterSpecificProvider,
			}),
		])

		this.models = models
		this.endpoints = endpoints

		return this.getModel()
	}

	override getModel() {
		const id = this.options.openRouterModelId ?? openRouterDefaultModelId
		let info = this.models[id] ?? openRouterDefaultModelInfo

		// If a specific provider is requested, use the endpoint for that provider.
		if (this.options.openRouterSpecificProvider && this.endpoints[this.options.openRouterSpecificProvider]) {
			info = this.endpoints[this.options.openRouterSpecificProvider]
		}

		const isDeepSeekR1 = id.startsWith("deepseek/deepseek-r1") || id === "perplexity/sonar-reasoning"

		const params = getModelParams({
			format: "openrouter",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: isDeepSeekR1 ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0,
		})

		return { id, info, topP: isDeepSeekR1 ? 0.95 : undefined, ...params }
	}

	async completePrompt(prompt: string) {
		let { id: modelId, maxTokens, temperature, reasoning } = await this.fetchModel()

		const completionParams: OpenRouterChatCompletionParams = {
			model: modelId,
			max_tokens: maxTokens,
			temperature,
			messages: [{ role: "user", content: prompt }],
			stream: false,
			// Only include provider if openRouterSpecificProvider is not "[default]".
			...(this.options.openRouterSpecificProvider &&
				this.options.openRouterSpecificProvider !== OPENROUTER_DEFAULT_PROVIDER_NAME && {
					provider: {
						order: [this.options.openRouterSpecificProvider],
						only: [this.options.openRouterSpecificProvider],
						allow_fallbacks: false,
					},
				}),
			...(reasoning && { reasoning }),
		}

		let response
		try {
			response = await this.client.chat.completions.create(completionParams)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}

		if ("error" in response) {
			const error = response.error as { message?: string; code?: number }
			throw new Error(`OpenRouter API Error ${error?.code}: ${error?.message}`)
		}

		const completion = response as OpenAI.Chat.ChatCompletion
		return completion.choices[0]?.message?.content || ""
	}

	/**
	 * Generate an image using OpenRouter's image generation API
	 * @param prompt The text prompt for image generation
	 * @param model The model to use for generation
	 * @param apiKey The OpenRouter API key (must be explicitly provided)
	 * @param inputImage Optional base64 encoded input image data URL
	 * @returns The generated image data and format, or an error
	 */
	async generateImage(
		prompt: string,
		model: string,
		apiKey: string,
		inputImage?: string,
	): Promise<ImageGenerationResult> {
		if (!apiKey) {
			return {
				success: false,
				error: "OpenRouter API key is required for image generation",
			}
		}

		try {
			const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					"HTTP-Referer": "https://github.com/RooVetGit/Roo-Code",
					"X-Title": "Roo Code",
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "user",
							content: inputImage
								? [
										{
											type: "text",
											text: prompt,
										},
										{
											type: "image_url",
											image_url: {
												url: inputImage,
											},
										},
									]
								: prompt,
						},
					],
					modalities: ["image", "text"],
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				let errorMessage = `Failed to generate image: ${response.status} ${response.statusText}`
				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorMessage = `Failed to generate image: ${errorJson.error.message}`
					}
				} catch {
					// Use default error message
				}
				return {
					success: false,
					error: errorMessage,
				}
			}

			const result: ImageGenerationResponse = await response.json()

			if (result.error) {
				return {
					success: false,
					error: `Failed to generate image: ${result.error.message}`,
				}
			}

			// Extract the generated image from the response
			const images = result.choices?.[0]?.message?.images
			if (!images || images.length === 0) {
				return {
					success: false,
					error: "No image was generated in the response",
				}
			}

			const imageData = images[0]?.image_url?.url
			if (!imageData) {
				return {
					success: false,
					error: "Invalid image data in response",
				}
			}

			// Extract base64 data from data URL
			const base64Match = imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
			if (!base64Match) {
				return {
					success: false,
					error: "Invalid image format received",
				}
			}

			return {
				success: true,
				imageData: imageData,
				imageFormat: base64Match[1],
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error occurred",
			}
		}
	}
}
