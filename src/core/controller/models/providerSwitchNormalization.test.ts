import { describe, expect, it } from "vitest"
import { deepSeekDefaultModelId } from "@/shared/api"
import { normalizeDeepSeekProviderSwitch } from "./providerSwitchNormalization"

describe("normalizeDeepSeekProviderSwitch", () => {
	it("resets the act generic model id when switching to DeepSeek", () => {
		const result = normalizeDeepSeekProviderSwitch(
			{ actModeApiProvider: "cline", actModeApiModelId: "anthropic/claude-sonnet-4.6" },
			{ actModeApiProvider: "deepseek" },
		)

		expect(result).toEqual({
			actModeApiProvider: "deepseek",
			actModeApiModelId: deepSeekDefaultModelId,
		})
	})

	it("resets both generic model ids when synced modes switch to DeepSeek", () => {
		const result = normalizeDeepSeekProviderSwitch(
			{
				planModeApiProvider: "cline",
				actModeApiProvider: "cline",
				planModeApiModelId: "anthropic/claude-sonnet-4.6",
				actModeApiModelId: "anthropic/claude-sonnet-4.6",
			},
			{ planModeApiProvider: "deepseek", actModeApiProvider: "deepseek" },
		)

		expect(result).toEqual({
			planModeApiProvider: "deepseek",
			actModeApiProvider: "deepseek",
			planModeApiModelId: deepSeekDefaultModelId,
			actModeApiModelId: deepSeekDefaultModelId,
		})
	})

	it("does not overwrite an existing DeepSeek provider selection", () => {
		const result = normalizeDeepSeekProviderSwitch(
			{ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" },
			{ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" },
		)

		expect(result).toEqual({ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" })
	})

	it("preserves an explicit DeepSeek model id provided with the provider switch", () => {
		const result = normalizeDeepSeekProviderSwitch(
			{ actModeApiProvider: "cline", actModeApiModelId: "anthropic/claude-sonnet-4.6" },
			{ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" },
		)

		expect(result).toEqual({ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" })
	})

	it("does not change unrelated provider switches", () => {
		const result = normalizeDeepSeekProviderSwitch(
			{ actModeApiProvider: "cline", actModeApiModelId: "anthropic/claude-sonnet-4.6" },
			{ actModeApiProvider: "openrouter" },
		)

		expect(result).toEqual({ actModeApiProvider: "openrouter" })
	})
})
