import { describe, expect, it } from "vitest"
import { transformRemoteConfigToStateShape } from "@/core/storage/remote-config/utils"

describe("transformRemoteConfigToStateShape - Bedrock prompt cache", () => {
	it("enforces the managed value for shared, Plan, and Act settings", () => {
		const result = transformRemoteConfigToStateShape({
			version: "v1",
			providerSettings: {
				AwsBedrock: { awsBedrockUsePromptCache: false },
			},
		})

		expect(result.awsBedrockUsePromptCache).toBe(false)
		expect(result.planModeAwsBedrockUsePromptCache).toBe(false)
		expect(result.actModeAwsBedrockUsePromptCache).toBe(false)
	})
})
