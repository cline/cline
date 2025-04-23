import type { Anthropic } from "@anthropic-ai/sdk"
// Restore GenerateContentConfig import and add GenerateContentResponseUsageMetadata
import { GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponseUsageMetadata } from "@google/genai"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, geminiDefaultModelId, GeminiModelId, geminiModels, ModelInfo } from "@shared/api"
import { convertAnthropicMessageToGemini } from "../transform/gemini-format"
import { ApiStream } from "../transform/stream"

// Define a default TTL for the cache (e.g., 1 hour in seconds)
const DEFAULT_CACHE_TTL_SECONDS = 3600

export class GeminiHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: GoogleGenAI // Updated client type

	// Internal state for caching
	private cacheName: string | null = null
	private cacheExpireTime: number | null = null
	private isFirstApiCall = true

	constructor(options: ApiHandlerOptions) {
		if (!options.geminiApiKey) {
			throw new Error("API key is required for Google Gemini")
		}
		this.options = options
		// Updated client initialization
		this.client = new GoogleGenAI({ apiKey: options.geminiApiKey })
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const { id: modelId, info: modelInfo } = this.getModel()

		// --- Cache Handling Logic ---
		const isCacheValid = this.cacheName && this.cacheExpireTime && Date.now() < this.cacheExpireTime
		let useCache = !this.isFirstApiCall && isCacheValid

		if (this.isFirstApiCall && !isCacheValid && systemPrompt) {
			// It's the first call, no valid cache exists, and we have a system prompt. Attempt cache creation.
			this.isFirstApiCall = false

			// Minimum token check heuristic (simple length check for now, could be improved)
			// Gemini requires minimum 4096 tokens. A simple length check isn't accurate but avoids complex token counting here.
			// Let's assume a generous average of 4 chars/token. 4096 tokens * 4 chars/token = 16384 chars.
			const MIN_SYSTEM_PROMPT_LENGTH_FOR_CACHE = 16384
			if (systemPrompt.length >= MIN_SYSTEM_PROMPT_LENGTH_FOR_CACHE) {
				// Start cache creation asynchronously, don't block the main request
				this.createCacheInBackground(modelId, systemPrompt)
			}
			// Proceed with the first request *without* using the cache, as it's being created.
			useCache = false
		} else if (!isCacheValid && this.cacheName) {
			// Cache exists but has expired
			this.cacheName = null
			this.cacheExpireTime = null
			useCache = false
		}
		// --- End Cache Handling Logic ---

		// Re-implement thinking budget logic based on new SDK structure
		const thinkingBudget = this.options.thinkingBudgetTokens ?? 0
		const maxBudget = modelInfo.thinkingConfig?.maxBudget ?? 0

		// port add baseUrl configuration for gemini api requests (#2843)
		const httpOptions = this.options.geminiBaseUrl ? { baseUrl: this.options.geminiBaseUrl } : undefined

		// Base generation config - Conditionally include systemInstruction based on cache usage
		const generationConfig: GenerateContentConfig = {
			httpOptions,
			temperature: 0, // Default temperature
			// Only include systemInstruction if NOT using the cache
			...(useCache ? {} : { systemInstruction: systemPrompt }),
		}

		// Convert messages to the format expected by @google/genai
		// Note: convertAnthropicMessageToGemini might need adjustments
		const contents: Content[] = messages.map(convertAnthropicMessageToGemini)

		// Construct the main request config - Type as GenerateContentConfig
		const requestConfig: GenerateContentConfig = {
			...generationConfig,
		}

		// Add thinking config if the model supports it
		if (modelInfo.thinkingConfig?.outputPrice !== undefined && maxBudget > 0) {
			requestConfig.thinkingConfig = {
				thinkingBudget: thinkingBudget,
			}
		}

		// Generate content using the new SDK structure via client.models
		const result = await this.client.models.generateContentStream({
			model: modelId, // Pass model ID directly
			contents,
			// Add cachedContent if using the cache
			config: {
				...requestConfig,
				...(useCache ? { cachedContent: this.cacheName! } : {}),
			},
		})

		// Declare variable to hold the last usage metadata found
		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined

		// Iterate directly over the stream
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

		if (lastUsageMetadata) {
			yield {
				type: "usage",
				inputTokens: lastUsageMetadata.promptTokenCount ?? 0,
				outputTokens: lastUsageMetadata.candidatesTokenCount ?? 0,
				cacheWriteTokens: lastUsageMetadata.cachedContentTokenCount ?? 0,
				cacheReadTokens: useCache ? (lastUsageMetadata.promptTokenCount ?? 0) : 0, // If cache used, prompt tokens are read from cache
			}
		}
	}

	private async createCacheInBackground(modelId: string, systemInstruction: string): Promise<void> {
		try {
			const cache = await this.client.caches.create({
				model: modelId,
				config: {
					systemInstruction: systemInstruction,
					ttl: `${DEFAULT_CACHE_TTL_SECONDS}s`,
				},
			})

			if (cache?.name) {
				this.cacheName = cache.name
				// Calculate expiry timestamp using the default TTL, as the response object might not contain it directly.
				this.cacheExpireTime = Date.now() + DEFAULT_CACHE_TTL_SECONDS * 1000
			} else {
				console.warn("Gemini cache creation call succeeded but returned no cache name.")
			}
		} catch (error) {
			console.error("Failed to create Gemini cache in background:", error)
			// Reset state if creation failed definitively
			this.cacheName = null
			this.cacheExpireTime = null
		}
	}

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
}
