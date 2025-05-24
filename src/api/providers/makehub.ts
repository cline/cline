import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, makehubDefaultModelId, makehubDefaultModelInfo } from "@shared/api"
import { withRetry } from "../retry"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"

export interface MakehubModelResponse {
	context: number
	model_id: string
	model_name: string
	display_name?: string // Nom à afficher dans l'interface utilisateur
	organisation: string
	price_per_input_token: number
	price_per_output_token: number
	provider_name: string
	quantisation: string | null
	max_tokens?: number
	supports_images?: boolean
	supports_prompt_cache?: boolean
	cache_writes_price?: number
	cache_reads_price?: number
	assistant_ready: boolean
	thinking_config?: {
		max_budget?: number
		output_price?: number
	}
	tiers?: Array<{
		context_window: number
		input_price?: number
		output_price?: number
		cache_writes_price?: number
		cache_reads_price?: number
	}>
	capabilities?: {
		image_input?: boolean
		tool_calling?: boolean
		json_mode?: boolean
	}
}

export class MakehubHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private lastGenerationId?: string

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.makehub.ai/v1",
			apiKey: this.options.makehubApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot",
				"X-Title": "Cline",
			},
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.lastGenerationId = undefined
		const model = this.getModel()

		// Convert messages to OpenAI format
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Set the price/performance ratio if specified
		const perfRatio = this.options.makehubPerfRatio ?? 0.5 // Default balanced value

		// Check if we need to use R1 format for specific models
		const modelId = model.id.toLowerCase()
		if (modelId.includes("deepseek") || modelId.includes("qwen") || modelId.includes("qwq")) {
			openAiMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
		}

		try {
			// Prepare options for the request with streaming explicitly enabled
			const response = await this.client.chat.completions.create(
				{
					model: model.id,
					messages: openAiMessages,
					stream: true,
					temperature: 0,
				},
				{
					headers: {
						"X-Price-Performance-Ratio": `${Math.round(perfRatio * 100)}`,
					},
				},
			)

			let didOutputUsage: boolean = false
			const modelInfo = model.info

			// Process the response stream
			for await (const chunk of response) {
				// Capture the generation ID for future statistics
				if (!this.lastGenerationId && chunk.id) {
					this.lastGenerationId = chunk.id
				}

				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				// Handle usage statistics if present
				if (!didOutputUsage && chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
						totalCost: this.calculateCost(
							chunk.usage.prompt_tokens || 0,
							chunk.usage.completion_tokens || 0,
							modelInfo,
						),
					}
					didOutputUsage = true
				}
			}

			// Retrieve usage statistics if they were not provided in the stream
			if (!didOutputUsage) {
				const apiStreamUsage = await this.getApiStreamUsage()
				if (apiStreamUsage) {
					yield apiStreamUsage
				}
			}
		} catch (error) {
			console.error("Error communicating with the MakeHub API:", error)
			throw error
		}
	}

	/**
	 * Calculate the total cost based on input and output tokens
	 */
	private calculateCost(inputTokens: number, outputTokens: number, modelInfo: ModelInfo): number {
		const inputCostPerMillion = modelInfo.inputPrice || 0
		const outputCostPerMillion = modelInfo.outputPrice || 0

		const inputCost = (inputTokens / 1_000_000) * inputCostPerMillion
		const outputCost = (outputTokens / 1_000_000) * outputCostPerMillion

		return inputCost + outputCost
	}

	/**
	 * Retrieve usage statistics for a past request
	 */
	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			// Allow time for the API to finalize statistics
			await setTimeoutPromise(500)
			try {
				// API call to retrieve usage statistics
				const response = await axios.get(`https://api.makehub.ai/v1/completions/${this.lastGenerationId}`, {
					headers: {
						Authorization: `Bearer ${this.options.makehubApiKey}`,
					},
					timeout: 10000,
				})

				const data = response.data
				if (data && data.usage) {
					const inputTokens = data.usage.prompt_tokens || 0
					const outputTokens = data.usage.completion_tokens || 0
					const modelInfo = this.getModel().info

					return {
						type: "usage",
						inputTokens: inputTokens,
						outputTokens: outputTokens,
						totalCost: this.calculateCost(inputTokens, outputTokens, modelInfo),
					}
				}
			} catch (error) {
				// Ignore errors and continue
				console.error("Error retrieving Makehub usage statistics:", error)
			}
		}
		return undefined
	}

	/**
	 * Retrieve information about the current model
	 */
	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.makehubModelId
		const modelInfo = this.options.makehubModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: makehubDefaultModelId, info: makehubDefaultModelInfo }
	}
}
