import { describe, expect, it } from "vitest"
import { toOnboardingModel } from "../useOnboardingModels"

describe("toOnboardingModel", () => {
	it("uses the provider catalog display name without changing the model id", () => {
		const model = toOnboardingModel(
			{
				id: "deepseek/deepseek-v4-flash",
				name: "deepseek-v4-flash",
				description: "Fast free model",
				tags: [],
			},
			"free",
			"Free",
			{
				"deepseek/deepseek-v4-flash": {
					name: "DeepSeek V4 Flash",
					supportsPromptCache: true,
				},
			},
		)

		expect(model).toMatchObject({
			id: "deepseek/deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			group: "free",
		})
	})
})
