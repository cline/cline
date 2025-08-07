import { ApiHandler } from "@api/index"

export function isClaude4ModelFamily(api: ApiHandler): boolean {
	const model = api.getModel()
	const modelId = model.id.toLowerCase()
	return (
		modelId.includes("sonnet-4") || modelId.includes("opus-4") || modelId.includes("4-sonnet") || modelId.includes("4-opus")
	)
}

export function isGemini2dot5ModelFamily(api: ApiHandler): boolean {
	const model = api.getModel()
	const modelId = model.id
	return modelId.includes("gemini-2.5")
}

export function isGrok4ModelFamily(api: ApiHandler): boolean {
	const model = api.getModel()
	const modelId = model.id.toLowerCase()
	return modelId.includes("grok-4")
}

export function modelDoesntSupportWebp(api: ApiHandler): boolean {
	const model = api.getModel()
	const modelId = model.id.toLowerCase()
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
