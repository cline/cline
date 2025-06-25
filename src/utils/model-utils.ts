import { ApiHandler } from "@api/index"

export function isClaude4ModelFamily(api: ApiHandler): boolean {
	const model = api.getModel()
	const modelId = model.id
	return modelId.includes("sonnet-4") || modelId.includes("opus-4")
}

export function isGemini2dot5ModelFamily(api: ApiHandler): boolean {
	const model = api.getModel()
	const modelId = model.id
	return modelId.includes("gemini-2.5")
}
