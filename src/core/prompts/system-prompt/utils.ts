import { ApiProviderInfo } from "@core/api"

export function isClaude4ModelFamily(id: string): boolean {
	const modelId = id.toLowerCase()
	return (
		modelId.includes("sonnet-4") || modelId.includes("opus-4") || modelId.includes("4-sonnet") || modelId.includes("4-opus")
	)
}

export function isGemini2dot5ModelFamily(id: string): boolean {
	const modelId = id.toLowerCase()
	return modelId.includes("gemini-2.5")
}

export function isGrok4ModelFamily(id: string): boolean {
	const modelId = id.toLowerCase()
	return modelId.includes("grok-4")
}

export function isGPT5ModelFamily(id: string): boolean {
	const modelId = id.toLowerCase()
	return modelId.includes("gpt-5") || modelId.includes("gpt5")
}

export function isNextGenModelFamily(id: string): boolean {
	return isClaude4ModelFamily(id) || isGemini2dot5ModelFamily(id) || isGrok4ModelFamily(id) || isGPT5ModelFamily(id)
}

export function isLocalModel(providerInfo: ApiProviderInfo): boolean {
	const localProviders = ["lmstudio", "ollama"]
	return localProviders.includes(normalize(providerInfo.providerId))
}

function normalize(text: string): string {
	return text.trim().toLowerCase()
}
