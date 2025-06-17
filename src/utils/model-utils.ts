import { ApiHandler } from "@api/index"

export function isClaude4ModelFamily(api: ApiHandler): boolean {
	const model = api.getModel()
	const modelId = model.id
	return modelId.includes("sonnet-4") || modelId.includes("opus-4")
}
