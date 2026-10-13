import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import { pickMaskedApiConfigurationUpdates } from "./updateApiConfigurationPartial"

describe("pickMaskedApiConfigurationUpdates", () => {
	it("does not carry stale Plan or shared prompt-cache values into an Act update", () => {
		const staleSnapshot: ApiConfiguration = {
			awsBedrockUsePromptCache: true,
			planModeAwsBedrockUsePromptCache: true,
			actModeAwsBedrockUsePromptCache: false,
		}

		expect(pickMaskedApiConfigurationUpdates(staleSnapshot, ["actModeAwsBedrockUsePromptCache"])).toEqual({
			actModeAwsBedrockUsePromptCache: false,
		})
	})
})
