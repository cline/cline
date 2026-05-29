import { openRouterDefaultModelId } from "@shared/api"
import { describe, expect, it } from "vitest"
import { getModeSpecificFields, normalizeApiConfiguration } from "../providerUtils"

describe("providerUtils Cline model defaults", () => {
	it("does not treat OpenRouter model state as Cline mode-specific fields", () => {
		const fields = getModeSpecificFields(
			{
				planModeApiProvider: "cline",
				planModeOpenRouterModelId: openRouterDefaultModelId,
				planModeOpenRouterModelInfo: { description: "stale OpenRouter model" },
			} as any,
			"plan",
		)

		expect(fields.clineModelId).toBeUndefined()
		expect(fields.clineModelInfo).toBeUndefined()
	})

	it("does not normalize a missing Cline model to the OpenRouter default", () => {
		const normalized = normalizeApiConfiguration(
			{
				planModeApiProvider: "cline",
				planModeOpenRouterModelId: openRouterDefaultModelId,
				planModeOpenRouterModelInfo: { description: "stale OpenRouter model" },
			} as any,
			"plan",
		)

		expect(normalized.selectedProvider).toBe("cline")
		expect(normalized.selectedModelId).toBe("")
	})
})
