import { describe, it } from "mocha"
import "should"
import { getHookModelContext } from "../hook-model-context"

describe("getHookModelContext", () => {
	it("should return concrete provider and model slug for plan mode", () => {
		const api = {
			getModel: () => ({ id: "handler-model-id" }),
		} as any

		const stateManager = {
			getGlobalSettingsKey: (key: string) => (key === "mode" ? "plan" : undefined),
			getApiConfiguration: () => ({
				planModeApiProvider: "openrouter",
				planModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
				actModeApiProvider: "openai",
			}),
		} as any

		const context = getHookModelContext(api, stateManager)
		context.provider?.should.equal("openrouter")
		context.slug?.should.equal("anthropic/claude-sonnet-4.5")
	})

	it("should fall back to unknown values when provider/slug are unavailable", () => {
		const api = {
			getModel: () => ({ id: "" }),
		} as any

		const stateManager = {
			getGlobalSettingsKey: (_: string) => "act",
			getApiConfiguration: () => ({
				planModeApiProvider: "anthropic",
				actModeApiProvider: "",
			}),
		} as any

		const context = getHookModelContext(api, stateManager)
		context.provider?.should.equal("unknown")
		context.slug?.should.equal("unknown")
	})
})
