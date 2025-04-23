import type { Anthropic } from "@anthropic-ai/sdk"
import {
	GoogleGenAI,
	type GenerateContentResponseUsageMetadata,
	type GenerateContentParameters,
	type Content,
} from "@google/genai"

import { SingleCompletionHandler } from "../"
import type { ApiHandlerOptions, GeminiModelId, ModelInfo } from "../../shared/api"
import { geminiDefaultModelId, geminiModels } from "../../shared/api"
import { convertAnthropicContentToGemini, convertAnthropicMessageToGemini } from "../transform/gemini-format"
import type { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"

const CACHE_TTL = 5

export class GeminiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: GoogleGenAI
	private contentCaches: Map<string, { key: string; count: number }>

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = new GoogleGenAI({ apiKey: options.geminiApiKey ?? "not-provided" })
		this.contentCaches = new Map()
	}

	async *createMessage(
		systemInstruction: string,
		messages: Anthropic.Messages.MessageParam[],
		cacheKey?: string,
	): ApiStream {
		const { id: model, thinkingConfig, maxOutputTokens, info } = this.getModel()

		const contents = messages.map(convertAnthropicMessageToGemini)
		let uncachedContent: Content[] | undefined = undefined
		let cachedContent: string | undefined = undefined
		let cacheWriteTokens: number | undefined = undefined

		// https://ai.google.dev/gemini-api/docs/caching?lang=node
		if (info.supportsPromptCache && cacheKey) {
			const cacheEntry = this.contentCaches.get(cacheKey)

			if (cacheEntry) {
				uncachedContent = contents.slice(cacheEntry.count, contents.length)
				cachedContent = cacheEntry.key
			}

			const newCacheEntry = await this.client.caches.create({
				model,
				config: { contents, systemInstruction, ttl: `${CACHE_TTL * 60}s` },
			})

			if (newCacheEntry.name) {
				this.contentCaches.set(cacheKey, { key: newCacheEntry.name, count: contents.length })
				cacheWriteTokens = newCacheEntry.usageMetadata?.totalTokenCount ?? 0
			}
		}

		const params: GenerateContentParameters = {
			model,
			contents: uncachedContent ?? contents,
			config: {
				cachedContent,
				systemInstruction: cachedContent ? undefined : systemInstruction,
				httpOptions: this.options.googleGeminiBaseUrl
					? { baseUrl: this.options.googleGeminiBaseUrl }
					: undefined,
				thinkingConfig,
				maxOutputTokens,
				temperature: this.options.modelTemperature ?? 0,
			},
		}

		const result = await this.client.models.generateContentStream(params)

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
			const cacheReadTokens = lastUsageMetadata.cachedContentTokenCount
			const reasoningTokens = lastUsageMetadata.thoughtsTokenCount

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
				reasoningTokens,
				totalCost,
			}
		}
	}

	override getModel() {
		let id = this.options.apiModelId ? (this.options.apiModelId as GeminiModelId) : geminiDefaultModelId
		let info: ModelInfo = geminiModels[id]

		if (id?.endsWith(":thinking")) {
			id = id.slice(0, -":thinking".length) as GeminiModelId

			if (geminiModels[id]) {
				info = geminiModels[id]

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
		cacheWriteTokens,
		cacheReadTokens,
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

		let inputTokensCost = inputPrice * (inputTokens / 1_000_000)
		let outputTokensCost = outputPrice * (outputTokens / 1_000_000)
		let cacheWriteCost = 0
		let cacheReadCost = 0

		if (cacheWriteTokens) {
			cacheWriteCost = cacheWritesPrice * (cacheWriteTokens / 1_000_000) * (CACHE_TTL / 60)
		}

		if (cacheReadTokens) {
			const uncachedReadTokens = inputTokens - cacheReadTokens
			cacheReadCost = cacheReadsPrice * (cacheReadTokens / 1_000_000)
			inputTokensCost = inputPrice * (uncachedReadTokens / 1_000_000)
		}

		return inputTokensCost + outputTokensCost + cacheWriteCost + cacheReadCost
	}
}
