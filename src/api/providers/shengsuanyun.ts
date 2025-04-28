import { Anthropic } from "@anthropic-ai/sdk"
import axios from "axios"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import OpenAI from "openai"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, ssyDefaultModelId, ssyDefaultModelInfo } from "../../shared/api"
import { withRetry } from "../retry"
import { createShengsuanyunStream } from "../transform/shengsuanyun-stream"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { OpenRouterErrorResponse } from "./types"
import { calculateApiCostOpenAI } from "../../utils/cost"

export class ShengsuanyunHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	lastGenerationId?: string

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://router.shengsuanyun.com/api/v1",
			apiKey: this.options.shengsuanyunApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://router.shengsuanyun.com/",
				"X-Title": "Cline",
			},
		})
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		this.lastGenerationId = undefined
		const model = this.getModel()
		const stream = await createShengsuanyunStream(
			this.client,
			systemPrompt,
			messages,
			model,
			this.options.o3MiniReasoningEffort,
			this.options.thinkingBudgetTokens,
			this.options.openRouterProviderSorting,
		)

		let didOutputUsage: boolean = false

		for await (const chunk of stream) {
			// openrouter returns an error object instead of the openai sdk throwing an error
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				console.error(`OpenRouter API Error: ${error?.code} - ${error?.message}`)
				// Include metadata in the error message if available
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				throw new Error(`OpenRouter API Error ${error.code}: ${error.message}${metadataStr}`)
			}

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

			// Reasoning tokens are returned separately from the content
			if ("reasoning" in delta && delta.reasoning) {
				yield {
					type: "reasoning",
					// @ts-ignore-next-line
					reasoning: delta.reasoning,
				}
			}

			if (!didOutputUsage && chunk.usage) {
				// Identify the provider and model from last chunk
				const chunkWithProvider = chunk as any
				// if (chunkWithProvider.provider) {
				// 	console.log("Provider:", chunkWithProvider.provider)
				// }
				// console.log("Model:", chunk.model)
				// if (chunkWithProvider.usage) {
				// 	console.log("Usage:", chunkWithProvider.usage)
				// }
				const inputTokens = chunk.usage.prompt_tokens || 0
				const outputTokens = chunk.usage.completion_tokens || 0
				const cacheWriteTokens = 0
				const cacheReadTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0
				yield {
					type: "usage",
					inputTokens: inputTokens,
					outputTokens: outputTokens,
					cacheReadTokens: cacheReadTokens,
					cacheWriteTokens: cacheWriteTokens,
					// @ts-ignore-next-line
					// totalCost: chunk.usage.cost || 0,
					totalCost: calculateApiCostOpenAI(model.info, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
				}
				didOutputUsage = true
			}
		}

		// Fallback to generation endpoint if usage chunk not returned ; NotImplemented yet
		if (!didOutputUsage) {
			const apiStreamUsage = await this.getApiStreamUsage()
			if (apiStreamUsage) {
				yield apiStreamUsage
			}
		}
	}

	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		if (this.lastGenerationId) {
			await setTimeoutPromise(500) // FIXME: necessary delay to ensure generation endpoint is ready
			try {
				const generationIterator = this.fetchGenerationDetails(this.lastGenerationId)
				const generation = (await generationIterator.next()).value
				// console.log("OpenRouter generation details:", generation)
				return {
					type: "usage",
					// cacheWriteTokens: 0,
					// cacheReadTokens: 0,
					// openrouter generation endpoint fails often
					inputTokens: generation?.native_tokens_prompt || 0,
					outputTokens: generation?.native_tokens_completion || 0,
					totalCost: generation?.total_cost || 0,
				}
			} catch (error) {
				// ignore if fails
				console.error("Error fetching OpenRouter generation details:", error)
			}
		}
		return undefined
	}

	@withRetry({ maxRetries: 4, baseDelay: 250, maxDelay: 1000, retryAllErrors: true })
	async *fetchGenerationDetails(genId: string) {
		// console.log("Fetching generation details for:", genId)
		try {
			const response = await axios.get(`https://router.shengsuanyun.com/api/v1/generation?id=${genId}`, {
				headers: {
					Authorization: `Bearer ${this.options.shengsuanyunApiKey}`,
				},
				timeout: 15_000, // this request hangs sometimes
			})
			yield response.data?.data
		} catch (error) {
			// ignore if fails
			console.error("Error fetching OpenRouter generation details:", error)
			throw error
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.ssyModelId
		const modelInfo = this.options.ssyModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: ssyDefaultModelId, info: ssyDefaultModelInfo }
	}
}
