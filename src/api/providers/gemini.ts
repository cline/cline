import type { Anthropic } from "@anthropic-ai/sdk"
// Restore GenerateContentConfig import and add GenerateContentResponseUsageMetadata
import { GoogleGenAI, type GenerateContentConfig, type GenerateContentResponseUsageMetadata } from "@google/genai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "@shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"
import { telemetryService } from "@services/posthog/telemetry/TelemetryService"

// Define a default TTL for the cache (e.g., 15 minutes in seconds)
const DEFAULT_CACHE_TTL_SECONDS = 900

interface GeminiHandlerOptions extends ApiHandlerOptions {
	isVertex?: boolean
}

/**
 * Handler for Google's Gemini API with optimized caching strategy and accurate cost accounting.
 *
 * Key features:
 * - One cache per task: Creates a single cache per task and reuses it for subsequent turns
 * - Stable cache keys: Uses taskId as a stable identifier for caches
 * - Efficient cache updates: Only updates caches when there's new content to add
 * - Split cost accounting: Separates immediate costs from ongoing cache storage costs
 *
 * Cost accounting approach:
 * - Immediate costs (per message): Input tokens, output tokens, and cache read costs
 * - Ongoing costs (per task): Cache storage costs for the TTL period
 *
 * Gemini's caching system is unique in that it charges for holding tokens in cache by the hour.
 * This implementation optimizes for both performance and cost by:
 * 1. Minimizing redundant cache creations
 * 2. Properly accounting for cache costs in the billing calculations
 * 3. Using a stable cache key to ensure cache reuse across turns
 * 4. Separating immediate costs from ongoing costs to avoid double-counting
 */
export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenAI

	constructor(options: GeminiHandlerOptions) {
		// Store the options
		this.options = options

		if (options.isVertex) {
			// Initialize with Vertex AI configuration
			const project = this.options.vertexProjectId ?? "not-provided"
			const location = this.options.vertexRegion ?? "not-provided"

			this.client = new GoogleGenAI({
				vertexai: true,
				project,
				location,
			})
		} else {
			// Initialize with standard API key
			if (!options.geminiApiKey) {
				throw new Error("API key is required for Google Gemini when not using Vertex AI")
			}

			this.client = new GoogleGenAI({ apiKey: options.geminiApiKey })
		}
	}

	/**
	 * Creates a message using the Gemini API with implicit caching.
	 *
	 * Cost accounting:
	 * - Immediate costs (returned in the usage object): Input tokens, output tokens, cache read costs
	 *
	 * @param systemPrompt The system prompt to use for the message
	 * @param messages The conversation history to include in the message
	 * @returns An async generator that yields chunks of the response with accurate immediate costs
	 */
	@withRetry({
		maxRetries: 4,
		baseDelay: 2000,
		maxDelay: 15000,
	})
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const { id: modelId, info } = this.getModel()
		const contents = messages.map(convertAnthropicMessageToGemini)

		// Configure thinking budget if supported
		const thinkingBudget = this.options.thinkingBudgetTokens ?? 0
		const maxBudget = info.thinkingConfig?.maxBudget ?? 0

		// Set up base generation config
		const requestConfig: GenerateContentConfig = {
			// Add base URL if configured
			httpOptions: this.options.geminiBaseUrl ? { baseUrl: this.options.geminiBaseUrl } : undefined,
			...{ systemInstruction: systemPrompt },
			// Set temperature (default to 0)
			temperature: 0,
		}

		// Add thinking config if the model supports it
		if (info.thinkingConfig?.outputPrice !== undefined && maxBudget > 0) {
			requestConfig.thinkingConfig = {
				thinkingBudget: thinkingBudget,
			}
		}

		// Generate content using the configured parameters
		const sdkCallStartTime = Date.now()
		let sdkFirstChunkTime: number | undefined
		let ttftSdkMs: number | undefined
		let apiSuccess = false
		let apiError: string | undefined
		let promptTokens = 0
		let outputTokens = 0
		let cacheReadTokens = 0
		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined

		try {
			const result = await this.client.models.generateContentStream({
				model: modelId,
				contents: contents,
				config: {
					...requestConfig,
				},
			})

			let isFirstSdkChunk = true
			for await (const chunk of result) {
				if (isFirstSdkChunk) {
					sdkFirstChunkTime = Date.now()
					ttftSdkMs = sdkFirstChunkTime - sdkCallStartTime
					isFirstSdkChunk = false
				}

				if (chunk.text) {
					yield {
						type: "text",
						text: chunk.text,
					}
				}

				if (chunk.usageMetadata) {
					lastUsageMetadata = chunk.usageMetadata
					promptTokens = lastUsageMetadata.promptTokenCount ?? promptTokens
					outputTokens = lastUsageMetadata.candidatesTokenCount ?? outputTokens
					cacheReadTokens = lastUsageMetadata.cachedContentTokenCount ?? cacheReadTokens
				}
			}
			apiSuccess = true

			if (lastUsageMetadata) {
				const totalCost = this.calculateCost({
					info,
					inputTokens: promptTokens,
					outputTokens,
					cacheReadTokens,
				})
				yield {
					type: "usage",
					inputTokens: promptTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens: 0,
					totalCost,
				}
			}
		} catch (error) {
			apiSuccess = false
			// Let the error propagate to be handled by withRetry or Task.ts
			// Telemetry will be sent in the finally block.
			if (error instanceof Error) {
				apiError = error.message

				// Gemini doesn't include status codes in their errors
				// https://github.com/googleapis/js-genai/blob/61f7f27b866c74333ca6331883882489bcb708b9/src/_api_client.ts#L569
				if (error.name === "ClientError" && error.message.includes("got status: 429 Too Many Requests.")) {
					;(error as any).status = 429
				}
			} else {
				apiError = String(error)
			}

			throw error
		} finally {
			const sdkCallEndTime = Date.now()
			const totalDurationSdkMs = sdkCallEndTime - sdkCallStartTime
			const cacheHit = cacheReadTokens > 0
			const cacheHitPercentage = promptTokens > 0 ? (cacheReadTokens / promptTokens) * 100 : undefined
			const throughputTokensPerSecSdk =
				totalDurationSdkMs > 0 && outputTokens > 0 ? outputTokens / (totalDurationSdkMs / 1000) : undefined

			if (this.options.taskId) {
				telemetryService.captureGeminiApiPerformance(
					this.options.taskId,
					modelId,
					{
						ttftSec: ttftSdkMs !== undefined ? ttftSdkMs / 1000 : undefined,
						totalDurationSec: totalDurationSdkMs / 1000,
						promptTokens,
						outputTokens,
						cacheReadTokens,
						cacheHit,
						cacheHitPercentage,
						apiSuccess,
						apiError,
						throughputTokensPerSec: throughputTokensPerSecSdk,
					},
					true,
				)
			} else {
				console.warn("GeminiHandler: taskId not available for telemetry in createMessage.")
			}
		}
	}

	/**
	 * Calculate the immediate dollar cost of the API call based on token usage and model pricing.
	 *
	 * This method accounts for the immediate costs of the API call:
	 * - Input token costs (for uncached tokens)
	 * - Output token costs
	 * - Cache read costs
	 * - Gemini implicit caching has no write costs
	 *
	 */
	public calculateCost({
		info,
		inputTokens,
		outputTokens,
		cacheReadTokens = 0,
	}: {
		info: ModelInfo
		inputTokens: number
		outputTokens: number
		cacheReadTokens?: number
	}) {
		// Exit early if any required pricing information is missing
		if (!info.inputPrice || !info.outputPrice) {
			return undefined
		}

		let inputPrice = info.inputPrice
		let outputPrice = info.outputPrice
		// Right now, we only show the immediate costs of caching and not the ongoing costs of storing the cache
		let cacheReadsPrice = info.cacheReadsPrice ?? 0

		// If there's tiered pricing then adjust prices based on the input tokens used
		if (info.tiers) {
			const tier = info.tiers.find((tier) => inputTokens <= tier.contextWindow)
			if (tier) {
				inputPrice = tier.inputPrice ?? inputPrice
				outputPrice = tier.outputPrice ?? outputPrice
				cacheReadsPrice = tier.cacheReadsPrice ?? cacheReadsPrice
			}
		}

		// Subtract the cached input tokens from the total input tokens
		const uncachedInputTokens = inputTokens - (cacheReadTokens ?? 0)

		// Calculate immediate costs only

		// 1. Input token costs (for uncached tokens)
		const inputTokensCost = inputPrice * (uncachedInputTokens / 1_000_000)

		// 2. Output token costs
		const outputTokensCost = outputPrice * (outputTokens / 1_000_000)

		// 3. Cache read costs (immediate)
		const cacheReadCost = (cacheReadTokens ?? 0) > 0 ? cacheReadsPrice * ((cacheReadTokens ?? 0) / 1_000_000) : 0

		// Calculate total immediate cost (excluding cache write/storage costs)
		const totalCost = inputTokensCost + outputTokensCost + cacheReadCost

		// Create the trace object for debugging
		const trace: Record<string, { price: number; tokens: number; cost: number }> = {
			input: { price: inputPrice, tokens: uncachedInputTokens, cost: inputTokensCost },
			output: { price: outputPrice, tokens: outputTokens, cost: outputTokensCost },
		}

		// Only include cache read costs in the trace (cache write costs are tracked separately)
		if ((cacheReadTokens ?? 0) > 0) {
			trace.cacheRead = { price: cacheReadsPrice, tokens: cacheReadTokens ?? 0, cost: cacheReadCost }
		}

		// console.log(`[GeminiHandler] calculateCost -> ${totalCost}`, trace)
		return totalCost
	}

	/**
	 * Get the model ID and info for the current configuration
	 */
	getModel(): { id: GeminiModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in geminiModels) {
			const id = modelId as GeminiModelId
			return { id, info: geminiModels[id] }
		}
		return {
			id: geminiDefaultModelId,
			info: geminiModels[geminiDefaultModelId],
		}
	}

	/**
	 * Count tokens in content using the Gemini API
	 */
	async countTokens(content: Array<any>): Promise<number> {
		try {
			const { id: model } = this.getModel()

			// Convert content to Gemini format
			const geminiContent = content.map((block) => {
				if (typeof block === "string") {
					return { text: block }
				}
				return { text: JSON.stringify(block) }
			})

			// Use Gemini's token counting API
			const response = await this.client.models.countTokens({
				model,
				contents: [{ parts: geminiContent }],
			})

			if (response.totalTokens === undefined) {
				console.warn("Gemini token counting returned undefined, using fallback")
				return this.estimateTokens(content)
			}

			return response.totalTokens
		} catch (error) {
			console.warn("Gemini token counting failed, using fallback", error)
			return this.estimateTokens(content)
		}
	}

	/**
	 * Fallback token estimation method
	 */
	private estimateTokens(content: Array<any>): number {
		// Simple estimation: ~4 characters per token
		const totalChars = content.reduce((total, block) => {
			if (typeof block === "string") {
				return total + block.length
			} else if (block && typeof block === "object") {
				// Safely stringify the object
				try {
					const jsonStr = JSON.stringify(block)
					return total + jsonStr.length
				} catch (e) {
					console.warn("Failed to stringify block for token estimation", e)
					return total
				}
			}
			return total
		}, 0)

		return Math.ceil(totalChars / 4)
	}
}
