import { ApiHandlerModel } from "@core/api"

export function isClaude4ModelFamily(modelId: string): boolean {
	return (
		modelId.includes("sonnet-4") || modelId.includes("opus-4") || modelId.includes("4-sonnet") || modelId.includes("4-opus")
	)
}

export function isGemini2dot5ModelFamily(modelId: string): boolean {
	return modelId.includes("gemini-2.5")
}

export function isGrok4ModelFamily(modelId: string): boolean {
	return modelId.includes("grok-4")
}

export function isGPT5ModelFamily(modelId: string): boolean {
	return modelId.includes("gpt-5") || modelId.includes("gpt5")
}

export function isNextGenModelFamily(modelId: string): boolean {
	return (
		isClaude4ModelFamily(modelId) ||
		isGemini2dot5ModelFamily(modelId) ||
		isGrok4ModelFamily(modelId) ||
		isGPT5ModelFamily(modelId)
	)
}

export function isLocalModelFamily(providerId: string): boolean {
	const localModels = ["lmstudio", "ollama"]
	return localModels.includes(providerId)
}
