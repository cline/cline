import { ApiHandlerModel } from "@core/api"

export function isClaude4ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return (
		modelId.includes("sonnet-4") || modelId.includes("opus-4") || modelId.includes("4-sonnet") || modelId.includes("4-opus")
	)
}

export function isGemini2dot5ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("gemini-2.5")
}

export function isGrok4ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("grok-4")
}

export function isGPT5ModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	const modelId = apiHandlerModel.id.toLowerCase()
	return modelId.includes("gpt-5") || modelId.includes("gpt5")
}

export function isNextGenModelFamily(apiHandlerModel: ApiHandlerModel): boolean {
	return (
		isClaude4ModelFamily(apiHandlerModel) ||
		isGemini2dot5ModelFamily(apiHandlerModel) ||
		isGrok4ModelFamily(apiHandlerModel) ||
		isGPT5ModelFamily(apiHandlerModel)
	)
}
