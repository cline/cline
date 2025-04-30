import type { Anthropic } from "@anthropic-ai/sdk"
// Restore GenerateContentConfig import and add GenerateContentResponseUsageMetadata
import { GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponseUsageMetadata } from "@google/genai"
import NodeCache from "node-cache"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "@shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

// Define a default TTL for the cache (e.g., 15 minutes in seconds)
const DEFAULT_CACHE_TTL_SECONDS = 900

export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenAI

	// Enhanced caching system
	private contentCaches: NodeCache
	private isCacheBusy = false

	constructor(options: ApiHandlerOptions) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options

		// Initialize Google Gemini client
		this.client = new GoogleGenAI({ apiKey: options.geminiApiKey })

		// Initialize cache with TTL and check period
		this.contentCaches = new NodeCache({ stdTTL: DEFAULT_CACHE_TTL_SECONDS, checkperiod: DEFAULT_CACHE_TTL_SECONDS })
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const { id: model, info } = this.getModel()
		const contents = messages.map(convertAnthropicMessageToGemini)

		// Generate a cache key based on the conversation
		const cacheKey = this.options.taskId || Date.now().toString()

		// Calculate total content length for cache eligibility check
		const contentsLength = systemPrompt.length + this.getMessagesLength(contents)

		// Minimum token threshold for caching (approx 4096 tokens)
		const CONTEXT_CACHE_TOKEN_MINIMUM = 4096

		let uncachedContent: Content[] | undefined = undefined
		let cachedContent: string | undefined = undefined

		// Check if caching is available and content is large enough to benefit from caching
		const isCacheAvailable = info.supportsPromptCache && contentsLength > 4 * CONTEXT_CACHE_TOKEN_MINIMUM && cacheKey

		let cacheWrite = false

		if (isCacheAvailable) {
			// Try to get existing cache entry
			const cacheEntry = this.contentCaches.get<{ key: string; count: number }>(cacheKey)

			if (cacheEntry) {
				// Use partial cache if available
				uncachedContent = contents.slice(cacheEntry.count, contents.length)
				cachedContent = cacheEntry.key
				console.log(
					`[GeminiHandler] using ${cacheEntry.count} cached messages (${cacheEntry.key}) and ${uncachedContent.length} uncached messages`,
				)
			}

			// Create cache in background if not busy
			if (!this.isCacheBusy) {
				this.isCacheBusy = true
				const timestamp = Date.now()

				this.client.caches
					.create({
						model,
						config: {
							contents,
							systemInstruction: systemPrompt,
							ttl: `${DEFAULT_CACHE_TTL_SECONDS}s`,
							httpOptions: { timeout: 120_000 },
						},
					})
					.then((result) => {
						const { name, usageMetadata } = result

						if (name) {
							this.contentCaches.set<{ key: string; count: number }>(cacheKey, {
								key: name,
								count: contents.length,
							})
							console.log(
								`[GeminiHandler] cached ${contents.length} messages (${usageMetadata?.totalTokenCount ?? "-"} tokens) in ${Date.now() - timestamp}ms`,
							)
						}
					})
					.catch((error) => {
						console.error(`[GeminiHandler] caches.create error`, error)
					})
					.finally(() => {
						this.isCacheBusy = false
					})

				cacheWrite = true
			}
		}

		const isCacheUsed = !!cachedContent

		// Configure thinking budget if supported
		const thinkingBudget = this.options.thinkingBudgetTokens ?? 0
		const maxBudget = info.thinkingConfig?.maxBudget ?? 0

		// Set up base generation config
		const requestConfig: GenerateContentConfig = {
			// Add base URL if configured
			httpOptions: this.options.geminiBaseUrl ? { baseUrl: this.options.geminiBaseUrl } : undefined,

			// Only include systemInstruction if NOT using the cache
			...(isCacheUsed ? {} : { systemInstruction: systemPrompt }),

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
		const result = await this.client.models.generateContentStream({
			model,
			contents: uncachedContent ?? contents,
			config: {
				...requestConfig,
				...(isCacheUsed ? { cachedContent } : {}),
			},
		})

		// Track usage metadata
		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined

		// Process the stream
		for await (const chunk of result) {
			if (chunk.text) {
				yield {
					type: "text",
					text: chunk.text,
				}
			}

			if (chunk.usageMetadata) {
				lastUsageMetadata = chunk.usageMetadata
			}
		}

		// Yield usage information at the end
		if (lastUsageMetadata) {
			const inputTokens = lastUsageMetadata.promptTokenCount ?? 0
			const outputTokens = lastUsageMetadata.candidatesTokenCount ?? 0
			const cacheWriteTokens = cacheWrite ? inputTokens : undefined
			const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount
			const totalCost = this.calculateCost({
				info,
				inputTokens,
				outputTokens,
				cacheWriteTokens,
				cacheReadTokens,
			})
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

	/**
	 * Calculate the dollar cost of the API call based on token usage and model pricing
	 */
	private calculateCost({
		info,
		inputTokens,
		outputTokens,
		cacheWriteTokens = 0,
		cacheReadTokens = 0,
	}: {
		info: ModelInfo
		inputTokens: number
		outputTokens: number
		cacheWriteTokens?: number
		cacheReadTokens?: number
	}) {
		// If pricing information is not available, return undefined
		if (!info.inputPrice && !info.inputPriceTiers && !info.outputPrice && !info.outputPriceTiers) {
			return undefined
		}

		let inputPrice = info.inputPrice ?? 0
		let outputPrice = info.outputPrice ?? 0
		let cacheWritesPrice = info.cacheWritesPrice ?? 0
		let cacheReadsPrice = info.cacheReadsPrice ?? 0

		// Handle tiered pricing based on input tokens
		if (info.inputPriceTiers) {
			const tier = info.inputPriceTiers.find((tier) => inputTokens <= tier.tokenLimit)
			if (tier) {
				inputPrice = tier.price
			}
		}

		// Handle tiered pricing for output tokens
		if (info.outputPriceTiers) {
			const tier = info.outputPriceTiers.find((tier) => inputTokens <= tier.tokenLimit)
			if (tier) {
				outputPrice = tier.price
			}
		}

		// Subtract cached input tokens from total input tokens
		const uncachedInputTokens = inputTokens - (cacheReadTokens ?? 0)

		// Calculate costs for each component
		const cacheWriteCost =
			cacheWriteTokens && cacheWriteTokens > 0
				? cacheWritesPrice * (cacheWriteTokens / 1_000_000) * (DEFAULT_CACHE_TTL_SECONDS / 3600)
				: 0

		const cacheReadCost = cacheReadTokens && cacheReadTokens > 0 ? cacheReadsPrice * (cacheReadTokens / 1_000_000) : 0

		const inputTokensCost = inputPrice * (uncachedInputTokens / 1_000_000)
		const outputTokensCost = outputPrice * (outputTokens / 1_000_000)

		// Calculate total cost
		const totalCost = inputTokensCost + outputTokensCost + cacheWriteCost + cacheReadCost

		// For debugging
		const trace: Record<string, { price: number; tokens: number; cost: number }> = {
			input: { price: inputPrice, tokens: uncachedInputTokens, cost: inputTokensCost },
			output: { price: outputPrice, tokens: outputTokens, cost: outputTokensCost },
		}

		if (cacheWriteTokens && cacheWriteTokens > 0) {
			trace.cacheWrite = { price: cacheWritesPrice, tokens: cacheWriteTokens, cost: cacheWriteCost }
		}

		if (cacheReadTokens && cacheReadTokens > 0) {
			trace.cacheRead = { price: cacheReadsPrice, tokens: cacheReadTokens, cost: cacheReadCost }
		}

		// console.log(`[GeminiHandler] calculateCost -> ${totalCost}`, trace)

		return totalCost
	}

	/**
	 * Calculate the total length of all messages for cache eligibility check
	 */
	private getMessagesLength(contents: Content[]): number {
		return contents.reduce((total, content) => {
			if (!content.parts) {
				return total
			}

			return (
				total +
				content.parts.reduce((partTotal, part) => {
					if (typeof part.text === "string") {
						return partTotal + part.text.length
					}
					return partTotal
				}, 0)
			)
		}, 0)
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
