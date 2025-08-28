import { ApiHandlerModel } from "@core/api"

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
