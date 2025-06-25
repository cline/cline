import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import axios from "axios"
import { OpenRouterErrorResponse } from "./types"
import { withRetry } from "../retry"

export class ClineHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	lastGenerationId?: string

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.cline.bot/v1",
			apiKey: this.options.clineApiKey || "",
			defaultHeaders: {
				"HTTP-Referer": "https://cline.bot", // Optional, for including your app on cline.bot rankings.
				"X-Title": "Cline", // Optional. Shows in rankings on cline.bot.
				"X-Task-ID": this.options.taskId || "", // Include the task ID in the request headers
			},
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.lastGenerationId = undefined

		const stream = await createOpenRouterStream(
			this.client,
			systemPrompt,
			messages,
			this.getModel(),
			this.options.reasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.openRouterProviderSorting,
		)

		let didOutputUsage: boolean = false

		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`Cline API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`Cline API Error ${error.code}: ${error.message}${metadataStr}`)
			}

			if (!this.lastGenerationId && chunk.id) {
				this.lastGenerationId = chunk.id
			}

			// Check for mid-stream error via finish_reason
			const choice = chunk.choices?.[0]
			// OpenRouter may return finish_reason = "error" with error details
			if ((choice?.finish_reason as string) === "error") {
				const choiceWithError = choice as any
				if (choiceWithError.error) {
					const error = choiceWithError.error
					console.error(`Cline Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
					throw new Error(`Cline Mid-Stream Error: ${error.code || error.type || "Unknown"} - ${error.message}`)
				} else {
					throw new Error("Cline Mid-Stream Error: Stream terminated with error status but no error details provided")
				}
			}

			const delta = choice?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}

			// Reasoning tokens are returned separately from the content
			if ("reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					// @ts-ignore-next-line
					reasoning: delta.reasoning,
				}
			}

			if (!didOutputUsage && chunk.usage) {
				// @ts-ignore-next-line
				let totalCost = (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0)
				const modelId = this.getModel().id
				const provider = modelId.split("/")[0]

				// If provider is x-ai, set totalCost to 0 (we're doing a promo)
				if (provider === "x-ai") {
					totalCost = 0
				}

				if (modelId.includes("gemini")) {
					yield {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						inputTokens: (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0),
						outputTokens: chunk.usage.completion_tokens || 0,
						// @ts-ignore-next-line
						totalCost,
					}
				} else {
					yield {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
						// @ts-ignore-next-line
						totalCost,
					}
				}
				didOutputUsage = true
			}
		}

		// Fallback to generation endpoint if usage chunk not returned
		if (!didOutputUsage) {
			const apiStreamUsage = await this.getApiStreamUsage()
			if (apiStreamUsage) {
				yield apiStreamUsage
			}
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			try {
				const response = await axios.get(`https://api.cline.bot/v1/generation?id=${this.lastGenerationId}`, {
					headers: {
						Authorization: `Bearer ${this.options.clineApiKey}`,
					},
					timeout: 15_000, // this request hangs sometimes
				})

				const generation = response.data
				let modelId = this.options.openRouterModelId
				if (modelId && modelId.includes("gemini")) {
					return {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: generation?.native_tokens_cached || 0,
						// openrouter generation endpoint fails often
						inputTokens: (generation?.native_tokens_prompt || 0) - (generation?.native_tokens_cached || 0),
						outputTokens: generation?.native_tokens_completion || 0,
						totalCost: generation?.total_cost || 0,
					}
				} else {
					return {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: generation?.native_tokens_cached || 0,
						// openrouter generation endpoint fails often
						inputTokens: generation?.native_tokens_prompt || 0,
						outputTokens: generation?.native_tokens_completion || 0,
						totalCost: generation?.total_cost || 0,
					}
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching cline generation details:", error)
			}
		}
		return undefined
	}

	getModel(): { id: string; info: ModelInfo } {
		let modelId = this.options.openRouterModelId
		if (modelId === "x-ai/grok-3") {
			modelId = "x-ai/grok-3-beta"
		}
		const modelInfo = this.options.openRouterModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: openRouterDefaultModelId, info: openRouterDefaultModelInfo }
	}
}
