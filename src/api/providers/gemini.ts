import type { Anthropic } from "@anthropic-ai/sdk"
import {
	GoogleGenAI,
	type GenerateContentResponseUsageMetadata,
	type GenerateContentParameters,
	type Content,
} from "@google/genai"
import type { JWTInput } from "google-auth-library"
import NodeCache from "node-cache"

import { ApiHandlerOptions, ModelInfo, GeminiModelId, geminiDefaultModelId, geminiModels } from "../../shared/api"
import { safeJsonParse } from "../../shared/safeJsonParse"

import { SingleCompletionHandler } from "../index"
import {
	convertAnthropicContentToGemini,
	convertAnthropicMessageToGemini,
	getMessagesLength,
} from "../transform/gemini-format"
import type { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"

const CACHE_TTL = 5
const CACHE_WRITE_FREQUENCY = 10
const CONTEXT_CACHE_TOKEN_MINIMUM = 4096

type CacheEntry = {
	key: string
	count: number
	tokens?: number
}

type GeminiHandlerOptions = ApiHandlerOptions & {
	isVertex?: boolean
}

export class GeminiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions

	private client: GoogleGenAI
	private contentCaches: NodeCache
	private isCacheBusy = false

	constructor({ isVertex, ...options }: GeminiHandlerOptions) {
		super()

		this.options = options

		const project = this.options.vertexProjectId ?? "not-provided"
		const location = this.options.vertexRegion ?? "not-provided"
		const apiKey = this.options.geminiApiKey ?? "not-provided"

		this.client = this.options.vertexJsonCredentials
			? new GoogleGenAI({
					vertexai: true,
					project,
					location,
					googleAuthOptions: {
						credentials: safeJsonParse<JWTInput>(this.options.vertexJsonCredentials, undefined),
					},
				})
			: this.options.vertexKeyFile
				? new GoogleGenAI({
						vertexai: true,
						project,
						location,
						googleAuthOptions: { keyFile: this.options.vertexKeyFile },
					})
				: isVertex
					? new GoogleGenAI({ vertexai: true, project, location })
					: new GoogleGenAI({ apiKey })

		this.contentCaches = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })
	}

	async *createMessage(
		systemInstruction: string,
		messages: Anthropic.Messages.MessageParam[],
		cacheKey?: string,
	): ApiStream {
		const { id: model, thinkingConfig, maxOutputTokens, info } = this.getModel()

		const contents = messages.map(convertAnthropicMessageToGemini)
		const contentsLength = systemInstruction.length + getMessagesLength(contents)

		let uncachedContent: Content[] | undefined = undefined
		let cachedContent: string | undefined = undefined

		// The minimum input token count for context caching is 4,096.
		// For a basic approximation we assume 4 characters per token.
		// We can use tiktoken eventually to get a more accurat token count.
		// https://ai.google.dev/gemini-api/docs/caching?lang=node
		// https://ai.google.dev/gemini-api/docs/tokens?lang=node
		const isCacheAvailable =
			info.supportsPromptCache &&
			!this.options.promptCachingDisabled &&
			cacheKey &&
			contentsLength > 4 * CONTEXT_CACHE_TOKEN_MINIMUM

		let isCacheWriteQueued = false

		if (isCacheAvailable) {
			const cacheEntry = this.contentCaches.get<CacheEntry>(cacheKey)

			if (cacheEntry) {
				uncachedContent = contents.slice(cacheEntry.count, contents.length)
				cachedContent = cacheEntry.key
				// console.log(
				// 	`[GeminiHandler] using cache entry ${cacheEntry.key} -> ${cacheEntry.count} messages, ${cacheEntry.tokens} tokens (+${uncachedContent.length} uncached messages)`,
				// )
			}

			// If `CACHE_WRITE_FREQUENCY` messages have been appended since the
			// last cache write then write a new cache entry.
			// TODO: Use a token count instead.
			if (!cacheEntry || (uncachedContent && uncachedContent.length >= CACHE_WRITE_FREQUENCY)) {
				isCacheWriteQueued = true
			}
		}

		const isCacheUsed = !!cachedContent

		const params: GenerateContentParameters = {
			model,
			contents: uncachedContent ?? contents,
			config: {
				cachedContent,
				systemInstruction: isCacheUsed ? undefined : systemInstruction,
				httpOptions: this.options.googleGeminiBaseUrl
					? { baseUrl: this.options.googleGeminiBaseUrl }
					: undefined,
				thinkingConfig,
				maxOutputTokens,
				temperature: this.options.modelTemperature ?? 0,
			},
		}

		const result = await this.client.models.generateContentStream(params)

		if (cacheKey && isCacheWriteQueued) {
			this.writeCache({ cacheKey, model, systemInstruction, contents })
		}

		let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined

		for await (const chunk of result) {
			if (chunk.text) {
				yield { type: "text", text: chunk.text }
			}

			if (chunk.usageMetadata) {
				lastUsageMetadata = chunk.usageMetadata
			}
		}

		if (lastUsageMetadata) {
			const inputTokens = lastUsageMetadata.promptTokenCount ?? 0
			const outputTokens = lastUsageMetadata.candidatesTokenCount ?? 0
			const cacheWriteTokens = isCacheWriteQueued ? inputTokens : undefined
			const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount
			const reasoningTokens = lastUsageMetadata.thoughtsTokenCount

			yield {
				type: "usage",
				inputTokens,
				outputTokens,
				cacheWriteTokens,
				cacheReadTokens,
				reasoningTokens,
				totalCost: this.calculateCost({
					info,
					inputTokens,
					outputTokens,
					cacheWriteTokens,
					cacheReadTokens,
				}),
			}
		}
	}

	override getModel() {
		let id = this.options.apiModelId ?? geminiDefaultModelId
		let info: ModelInfo = geminiModels[id as GeminiModelId]

		if (id?.endsWith(":thinking")) {
			id = id.slice(0, -":thinking".length)

			if (geminiModels[id as GeminiModelId]) {
				info = geminiModels[id as GeminiModelId]

				return {
					id,
					info,
					thinkingConfig: this.options.modelMaxThinkingTokens
						? { thinkingBudget: this.options.modelMaxThinkingTokens }
						: undefined,
					maxOutputTokens: this.options.modelMaxTokens ?? info.maxTokens ?? undefined,
				}
			}
		}

		if (!info) {
			id = geminiDefaultModelId
			info = geminiModels[geminiDefaultModelId]
		}

		return { id, info }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const { id: model } = this.getModel()

			const result = await this.client.models.generateContent({
				model,
				contents: [{ role: "user", parts: [{ text: prompt }] }],
				config: {
					httpOptions: this.options.googleGeminiBaseUrl
						? { baseUrl: this.options.googleGeminiBaseUrl }
						: undefined,
					temperature: this.options.modelTemperature ?? 0,
				},
			})

			return result.text ?? ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Gemini completion error: ${error.message}`)
			}

			throw error
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		try {
			const { id: model } = this.getModel()

			const response = await this.client.models.countTokens({
				model,
				contents: convertAnthropicContentToGemini(content),
			})

			if (response.totalTokens === undefined) {
				console.warn("Gemini token counting returned undefined, using fallback")
				return super.countTokens(content)
			}

			return response.totalTokens
		} catch (error) {
			console.warn("Gemini token counting failed, using fallback", error)
			return super.countTokens(content)
		}
	}

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
		if (!info.inputPrice || !info.outputPrice || !info.cacheWritesPrice || !info.cacheReadsPrice) {
			return undefined
		}

		let inputPrice = info.inputPrice
		let outputPrice = info.outputPrice
		let cacheWritesPrice = info.cacheWritesPrice
		let cacheReadsPrice = info.cacheReadsPrice

		// If there's tiered pricing then adjust the input and output token prices
		// based on the input tokens used.
		if (info.tiers) {
			const tier = info.tiers.find((tier) => inputTokens <= tier.contextWindow)

			if (tier) {
				inputPrice = tier.inputPrice ?? inputPrice
				outputPrice = tier.outputPrice ?? outputPrice
				cacheWritesPrice = tier.cacheWritesPrice ?? cacheWritesPrice
				cacheReadsPrice = tier.cacheReadsPrice ?? cacheReadsPrice
			}
		}

		// Subtract the cached input tokens from the total input tokens.
		const uncachedInputTokens = inputTokens - cacheReadTokens

		let cacheWriteCost =
			cacheWriteTokens > 0 ? cacheWritesPrice * (cacheWriteTokens / 1_000_000) * (CACHE_TTL / 60) : 0
		let cacheReadCost = cacheReadTokens > 0 ? cacheReadsPrice * (cacheReadTokens / 1_000_000) : 0

		const inputTokensCost = inputPrice * (uncachedInputTokens / 1_000_000)
		const outputTokensCost = outputPrice * (outputTokens / 1_000_000)
		const totalCost = inputTokensCost + outputTokensCost + cacheWriteCost + cacheReadCost

		const trace: Record<string, { price: number; tokens: number; cost: number }> = {
			input: { price: inputPrice, tokens: uncachedInputTokens, cost: inputTokensCost },
			output: { price: outputPrice, tokens: outputTokens, cost: outputTokensCost },
		}

		if (cacheWriteTokens > 0) {
			trace.cacheWrite = { price: cacheWritesPrice, tokens: cacheWriteTokens, cost: cacheWriteCost }
		}

		if (cacheReadTokens > 0) {
			trace.cacheRead = { price: cacheReadsPrice, tokens: cacheReadTokens, cost: cacheReadCost }
		}

		// console.log(`[GeminiHandler] calculateCost -> ${totalCost}`, trace)

		return totalCost
	}

	private writeCache({
		cacheKey,
		model,
		systemInstruction,
		contents,
	}: {
		cacheKey: string
		model: string
		systemInstruction: string
		contents: Content[]
	}) {
		// TODO: https://www.npmjs.com/package/p-queue
		if (this.isCacheBusy) {
			return
		}

		this.isCacheBusy = true
		// const timestamp = Date.now()

		const previousCacheEntry = this.contentCaches.get<CacheEntry>(cacheKey)

		this.client.caches
			.create({
				model,
				config: {
					contents,
					systemInstruction,
					ttl: `${CACHE_TTL * 60}s`,
					httpOptions: { timeout: 120_000 },
				},
			})
			.then((result) => {
				const { name, usageMetadata } = result

				if (name) {
					const newCacheEntry: CacheEntry = {
						key: name,
						count: contents.length,
						tokens: usageMetadata?.totalTokenCount,
					}

					this.contentCaches.set<CacheEntry>(cacheKey, newCacheEntry)

					// console.log(
					// 	`[GeminiHandler] created cache entry ${newCacheEntry.key} -> ${newCacheEntry.count} messages, ${newCacheEntry.tokens} tokens (${Date.now() - timestamp}ms)`,
					// )

					if (previousCacheEntry) {
						// const timestamp = Date.now()

						this.client.caches
							.delete({ name: previousCacheEntry.key })
							.then(() => {
								// console.log(
								// 	`[GeminiHandler] deleted cache entry ${previousCacheEntry.key} -> ${previousCacheEntry.count} messages, ${previousCacheEntry.tokens} tokens (${Date.now() - timestamp}ms)`,
								// )
							})
							.catch((error) => {
								console.error(
									`[GeminiHandler] failed to delete stale cache entry ${previousCacheEntry.key} -> ${error instanceof Error ? error.message : String(error)}`,
								)
							})
					}
				}
			})
			.catch((error) => {
				console.error(`[GeminiHandler] caches.create error`, error)
			})
			.finally(() => {
				this.isCacheBusy = false
			})
	}
}
