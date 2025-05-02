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

	// Enhanced caching system
	private contentCaches: NodeCache // Stores cache details (key, count, etc.)
	private isCacheBusy = false
	private taskCacheNames: Map<string, string> = new Map() // Maps taskId to cache name for stable lookup
	private taskCacheTokens: Map<string, number> = new Map() // Maps taskId to total tokens in cache

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

		// Initialize cache with TTL and check period
		this.contentCaches = new NodeCache({
			stdTTL: DEFAULT_CACHE_TTL_SECONDS,
			checkperiod: DEFAULT_CACHE_TTL_SECONDS,
		})
	}

	/**
	 * Creates a message using the Gemini API with optimized caching and split cost accounting.
	 *
	 * This method implements a task-based caching strategy:
	 * 1. Each task gets its own cache, identified by taskId
	 * 2. On first call for a task, a new cache is created
	 * 3. On subsequent calls, the existing cache is reused and only new messages are sent
	 * 4. Cache operations are tracked for accurate cost accounting
	 *
	 * Cost accounting:
	 * - Immediate costs (returned in the usage object): Input tokens, output tokens, cache read costs
	 * - Ongoing costs (tracked at task level): Cache storage costs for the TTL period
	 *
	 * @param systemPrompt The system prompt to use for the message
	 * @param messages The conversation history to include in the message
	 * @returns An async generator that yields chunks of the response with accurate immediate costs
	 */
	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const { id: model, info } = this.getModel()
		const contents = messages.map(convertAnthropicMessageToGemini)

		// Ensure we have a stable cache key (taskId)
		if (!this.options.taskId) {
			console.warn("[GeminiHandler] No taskId provided, caching will be disabled")
		}

		const taskId = this.options.taskId

		// Calculate total content length for cache eligibility check
		const contentsLength = systemPrompt.length + this.getMessagesLength(contents)

		// Minimum token threshold for caching (approx 4096 tokens)
		const CONTEXT_CACHE_TOKEN_MINIMUM = 4096

		let uncachedContent: Content[] | undefined = undefined
		let cachedContent: string | undefined = undefined

		// Check if caching is available and content is large enough to benefit from caching
		// We only enable caching for conversations above a certain size to avoid overhead for small requests
		const isCacheAvailable = info.supportsPromptCache && contentsLength > 4 * CONTEXT_CACHE_TOKEN_MINIMUM && taskId

		// This flag tracks whether this operation involves a cache write/update
		// It's used to track task-level ongoing costs, not immediate costs
		let cacheWrite = false

		if (isCacheAvailable) {
			// Check if we already have a cache for this task
			const existingCacheName = this.taskCacheNames.get(taskId)
			const cacheEntry = existingCacheName ? this.contentCaches.get<{ key: string; count: number }>(taskId) : undefined

			if (cacheEntry) {
				// Use existing cache
				uncachedContent = contents.slice(cacheEntry.count, contents.length)
				cachedContent = cacheEntry.key
				console.log(
					`[GeminiHandler] using existing cache for task ${taskId}: ${cacheEntry.count} cached messages (${cacheEntry.key}) and ${uncachedContent.length} uncached messages`,
				)
			}

			// Create or update cache only if there's new content to add
			const shouldUpdateCache = !existingCacheName || (cacheEntry && uncachedContent && uncachedContent.length > 0)

			if (shouldUpdateCache) {
				// If we should update the cache, then there will be a cache write
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

		// Update the cache after the LLM request is already sent to avoid blocking
		// We only update the cache if we have a taskId and the cache write flag is set
		// This is a non-blocking operation and will not affect the response time
		if (cacheWrite && taskId) {
			this.updateCacheContent(taskId, model, contents, systemPrompt)
		}
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
			const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount

			// Calculate immediate costs only (excluding cache write/storage costs)
			const totalCost = this.calculateCost({
				info,
				inputTokens,
				outputTokens,
				cacheReadTokens,
			})

			// Store the token count for task-level ongoing cost tracking
			// This is not included in the immediate costs returned to the user
			const cacheWriteTokens = cacheWrite ? inputTokens : undefined

			// If this is a cache write operation, update the task's ongoing costs
			if (cacheWrite && this.options.taskId && inputTokens > 0) {
				// Log the ongoing costs for debugging
				const ongoingCosts = this.getTaskOngoingCosts(this.options.taskId)
				console.log(
					`[GeminiHandler] Task ${this.options.taskId} ongoing costs: $${ongoingCosts?.toFixed(6) ?? "unknown"}`,
				)
			}

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens,
				totalCost,
			}
		}
	}

	/**
	 * Lists all caches for the current API key.
	 *
	 * According to the Gemini API documentation, you can retrieve metadata for all uploaded caches
	 * using the caches.list() method. This is useful for monitoring cache usage and cleanup.
	 *
	 * @param pageSize Optional number of caches to return per page (default: 10)
	 * @returns A promise that resolves to an array of cache metadata objects
	 */
	public async listCaches(pageSize: number = 10): Promise<any[]> {
		try {
			const caches: any[] = []
			const pager = await this.client.caches.list({ config: { pageSize } })

			let page = pager.page
			while (true) {
				for (const cache of page) {
					caches.push(cache)
				}

				if (!pager.hasNextPage()) {
					break
				}
				page = await pager.nextPage()
			}

			return caches
		} catch (error) {
			console.error(`[GeminiHandler] Failed to list caches:`, error)
			return []
		}
	}

	/**
	 * Updates the content of a cache for a specific task.
	 *
	 * Since the Gemini API doesn't support incremental updates to cache content,
	 * this method:
	 * 1. Creates a new cache with the full content (old + new)
	 * 2. Deletes the old cache if it exists
	 * 3. Updates our local tracking to point to the new cache
	 *
	 * @param taskId The ID of the task whose cache should be updated
	 * @param model The model to use for the cache
	 * @param contents The full content to cache (including both old and new messages)
	 * @param systemInstruction The system instruction to include in the cache
	 */
	private async updateCacheContent(
		taskId: string,
		model: string,
		contents: Content[],
		systemInstruction: string,
	): Promise<void> {
		if (this.isCacheBusy) {
			console.log(`[GeminiHandler] Cache is busy, skipping update for task ${taskId}`)
			return
		}

		this.isCacheBusy = true
		const timestamp = Date.now()
		const existingCacheName = this.taskCacheNames.get(taskId)

		try {
			// 1. Create a new cache with the full content
			const result = await this.client.caches.create({
				model,
				config: {
					contents,
					systemInstruction,
					ttl: `${DEFAULT_CACHE_TTL_SECONDS}s`,
					httpOptions: { timeout: 120_000 },
				},
			})

			const { name, usageMetadata } = result

			if (name) {
				// 2. Delete the old cache if it exists (non-blocking)
				// We don't await this operation to avoid blocking the main flow if deletion fails
				if (existingCacheName) {
					// Schedule cache deletion in the background
					setTimeout(() => {
						this.client.caches
							.delete({ name: existingCacheName })
							.then(() => {
								console.log(`[GeminiHandler] Deleted old cache ${existingCacheName} for task ${taskId}`)
							})
							.catch((error) => {
								console.error(`[GeminiHandler] Failed to delete old cache ${existingCacheName}:`, error)
								console.log(`[GeminiHandler] Continuing without deleting old cache. It will expire after TTL.`)
							})
					}, 1000)
				}

				// 3. Update our local tracking
				this.contentCaches.set<{ key: string; count: number }>(taskId, {
					key: name,
					count: contents.length,
				})
				this.taskCacheNames.set(taskId, name)

				// Track total tokens in cache for ongoing cost calculation
				const totalTokens = usageMetadata?.totalTokenCount ?? 0
				this.taskCacheTokens.set(taskId, totalTokens)

				const operation = existingCacheName ? "Updated" : "Created new"
				console.log(
					`[GeminiHandler] ${operation} cache for task ${taskId}: ${contents.length} messages (${totalTokens} tokens) in ${Date.now() - timestamp}ms`,
				)

				return // Indicate that a cache write occurred
			}

			return
		} catch (error) {
			console.error(`[GeminiHandler] Failed to update cache for task ${taskId}:`, error)
			return
		} finally {
			this.isCacheBusy = false
		}
	}

	/**
	 * Updates the TTL of an existing cache.
	 *
	 * According to the Gemini API documentation, you can update the TTL of a cache
	 * using the caches.update() method. This is useful for extending the lifetime
	 * of a cache that's still being used.
	 *
	 * @param taskId The ID of the task whose cache TTL should be updated
	 * @param ttlSeconds The new TTL in seconds
	 * @returns A promise that resolves to the updated cache, or undefined if the update fails
	 */
	public async updateCacheTTL(taskId: string, ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS): Promise<any> {
		const cacheName = this.taskCacheNames.get(taskId)
		if (!cacheName) {
			console.warn(`[GeminiHandler] No cache found for task ${taskId}, cannot update TTL`)
			return
		}

		try {
			const updatedCache = await this.client.caches.update({
				name: cacheName,
				config: { ttl: `${ttlSeconds}s` },
			})

			console.log(`[GeminiHandler] Updated TTL for cache ${cacheName} to ${ttlSeconds}s`)
			return updatedCache
		} catch (error) {
			console.error(`[GeminiHandler] Failed to update TTL for cache ${cacheName}:`, error)
		}
	}

	/**
	 * Calculate the ongoing costs for a task based on cache storage.
	 *
	 * This method calculates the cost of holding tokens in cache for the TTL period.
	 * These costs are separate from the immediate costs of API calls and should be
	 * tracked at the task level rather than the message level.
	 *
	 * TODO: Surface these ongoing costs to the user in the UI, possibly in:
	 * - The task header/summary
	 * - A dedicated "costs" panel or tooltip
	 * - As part of the total cost calculation for the task
	 *
	 * @param taskId The ID of the task to calculate ongoing costs for
	 * @returns The ongoing cost in dollars, or undefined if no cache exists for the task
	 */
	public getTaskOngoingCosts(taskId: string): number | undefined {
		const tokens = this.taskCacheTokens.get(taskId)
		if (!tokens) {
			return undefined
		}

		const { info } = this.getModel()
		if (!info.cacheWritesPrice) {
			return undefined
		}

		// Calculate the cost of holding tokens in cache for the TTL period
		// (tokens / 1M) * (price per 1M tokens) * (cache TTL in hours)
		return info.cacheWritesPrice * (tokens / 1_000_000) * (DEFAULT_CACHE_TTL_SECONDS / 3600)
	}

	/**
	 * Calculate the immediate dollar cost of the API call based on token usage and model pricing.
	 *
	 * This method accounts for the immediate costs of the API call:
	 * - Input token costs (for uncached tokens)
	 * - Output token costs
	 * - Cache read costs
	 *
	 * It does NOT include ongoing costs like cache storage, which are tracked separately
	 * at the task level through getTaskOngoingCosts().
	 */
	public calculateCost({
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
		// Exit early if any required pricing information is missing
		if (!info.inputPrice || !info.outputPrice) {
			return undefined
		}

		let inputPrice = info.inputPrice
		let outputPrice = info.outputPrice
		let cacheWritesPrice = info.cacheWritesPrice ?? 0
		// Right now, we only show the immediate costs of caching and not the ongoing costs of storing the cache
		cacheWritesPrice = 0
		let cacheReadsPrice = info.cacheReadsPrice ?? 0

		// If there's tiered pricing then adjust prices based on the input tokens used
		if (info.tiers) {
			const tier = info.tiers.find((tier) => inputTokens <= tier.contextWindow)
			if (tier) {
				inputPrice = tier.inputPrice ?? inputPrice
				outputPrice = tier.outputPrice ?? outputPrice
				cacheWritesPrice = tier.cacheWritesPrice ?? cacheWritesPrice
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
