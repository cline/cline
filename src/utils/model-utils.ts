import { ApiHandlerModel, ApiProviderInfo } from "@core/api"
import { AnthropicModelId, anthropicModels } from "@/shared/api"

export function modelDoesntSupportWebp(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("grok")
}

/**
 * Determines if reasoning content should be skipped for a given model
 * Currently skips reasoning for Grok-4 models since they only display "thinking" without useful information
 */
export function shouldSkipReasoningForModel(modelId?: string): boolean {
	if (!modelId) {
		return false
	}
	return modelId.includes("grok-4")
}

export function isAnthropicModelId(modelId: string): modelId is AnthropicModelId {
	return modelId in anthropicModels || isClaude4ModelFamily(modelId)
}

export function isClaude4ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return (
		modelId.includes("sonnet-4") || modelId.includes("opus-4") || modelId.includes("4-sonnet") || modelId.includes("4-opus")
	)
}

export function isGemini2dot5ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gemini-2.5")
}

export function isGrok4ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("grok-4")
}

export function isGPT5ModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return modelId.includes("gpt-5") || modelId.includes("gpt5")
}

export function isNextGenModelFamily(id: string): boolean {
	const modelId = normalize(id)
	return (
		isClaude4ModelFamily(modelId) ||
		isGemini2dot5ModelFamily(modelId) ||
		isGrok4ModelFamily(modelId) ||
		isGPT5ModelFamily(modelId)
	)
}

export function isLocalModel(providerInfo: ApiProviderInfo): boolean {
	const localProviders = ["lmstudio", "ollama"]
	return localProviders.includes(normalize(providerInfo.providerId))
}

/**
 * Parses a price string and converts it from per-token to per-million-tokens
 * @param priceString The price string to parse (e.g. from API responses)
 * @returns The price multiplied by 1,000,000 for per-million-token pricing, or 0 if invalid
 */
export function parsePrice(priceString: string | undefined): number {
	if (!priceString || priceString === "" || priceString === "0") {
		return 0
	}
	const parsed = parseFloat(priceString)
	if (Number.isNaN(parsed)) {
		return 0
	}
	// Convert from per-token to per-million-tokens (multiply by 1,000,000)
	return parsed * 1_000_000
}

function normalize(text: string): string {
	return text.trim().toLowerCase()
}
