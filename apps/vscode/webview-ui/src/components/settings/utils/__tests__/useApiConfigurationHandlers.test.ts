import { describe, expect, it } from "vitest"
import { buildApiConfigurationPartialRequest } from "../useApiConfigurationHandlers"

describe("prompt-cache partial API updates", () => {
	it.each([
		["shared", { awsBedrockUsePromptCache: false }, "awsBedrockUsePromptCache"],
		["Plan", { planModeAwsBedrockUsePromptCache: true }, "planModeAwsBedrockUsePromptCache"],
		["Act", { actModeAwsBedrockUsePromptCache: true }, "actModeAwsBedrockUsePromptCache"],
	] as const)("updates only the %s prompt-cache field", (_name, updates, field) => {
		const request = buildApiConfigurationPartialRequest(updates)

		expect(request.updateMask).toEqual([field])
		expect(request.apiConfiguration?.awsBedrockUsePromptCache).toBe(field === "awsBedrockUsePromptCache" ? false : undefined)
		expect(request.apiConfiguration?.planModeAwsBedrockUsePromptCache).toBe(
			field === "planModeAwsBedrockUsePromptCache" ? true : undefined,
		)
		expect(request.apiConfiguration?.actModeAwsBedrockUsePromptCache).toBe(
			field === "actModeAwsBedrockUsePromptCache" ? true : undefined,
		)
	})
})
