import { ModelInfo } from "@shared/api"
import axios, { AxiosError } from "axios"

export interface FetchOpenAiCompatibleModelsOptions {
	baseUrl: string
	headers?: Record<string, string | undefined>
	transform?: (model: any) => Partial<ModelInfo>
}

/**
 * Normalizes a base URL to ensure it ends with /v1
 */
export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, "")
	if (trimmed.endsWith("/v1")) {
		return trimmed
	}
	return `${trimmed}/v1`
}

/**
 * Fetches models from an OpenAI-compatible /v1/models endpoint and maps them to ModelInfo objects.
 */
export async function fetchOpenAiCompatibleModels({
	baseUrl,
	headers = {},
	transform,
}: FetchOpenAiCompatibleModelsOptions): Promise<Record<string, ModelInfo>> {
	const normalizedBaseUrl = normalizeOpenAiCompatibleBaseUrl(baseUrl || "http://localhost:4000")
	const url = `${normalizedBaseUrl}/models`

	try {
		const response = await axios.get(url, {
			headers: Object.fromEntries(Object.entries(headers).filter(([_, value]) => Boolean(value))),
			timeout: 15000,
		})

		const rawModels = Array.isArray(response.data?.data) ? response.data.data : []

		const models: Record<string, ModelInfo> = {}
		for (const rawModel of rawModels) {
			if (!rawModel || typeof rawModel.id !== "string") {
				continue
			}

			const transformed = transform ? transform(rawModel) : {}
			models[rawModel.id] = {
				supportsPromptCache: false,
				description:
					transformed.description ??
					rawModel.description ??
					(rawModel.owned_by ? `Provided by ${rawModel.owned_by}` : undefined),
				maxTokens: transformed.maxTokens,
				contextWindow: transformed.contextWindow,
				supportsImages: transformed.supportsImages,
				inputPrice: transformed.inputPrice,
				outputPrice: transformed.outputPrice,
				cacheWritesPrice: transformed.cacheWritesPrice,
				cacheReadsPrice: transformed.cacheReadsPrice,
				thinkingConfig: transformed.thinkingConfig,
				tiers: transformed.tiers,
				supportsGlobalEndpoint: transformed.supportsGlobalEndpoint,
			}
		}

		return models
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const axiosError = error as AxiosError
			throw new Error(
				`Failed to fetch models from ${url}: ${axiosError.response?.status} ${axiosError.response?.statusText || axiosError.message}`,
			)
		}

		throw error
	}
}
