import { ProviderConfigResponse } from "@shared/proto/cline/models"
import { describe, expect, it } from "vitest"
import { reasoningEffortPatch, savedReasoningEffort } from "../reasoningEffort"

describe("savedReasoningEffort", () => {
	it("is null while the config is loading", () => {
		expect(savedReasoningEffort(undefined)).toBeNull()
	})

	it("is Default when nothing is saved", () => {
		expect(savedReasoningEffort(ProviderConfigResponse.create({ providerId: "openai" }))).toBe("default")
	})

	it("returns the saved level, including None", () => {
		expect(savedReasoningEffort(ProviderConfigResponse.create({ providerId: "openai", reasoningEffort: "none" }))).toBe(
			"none",
		)
		expect(savedReasoningEffort(ProviderConfigResponse.create({ providerId: "openai", reasoningEffort: "high" }))).toBe(
			"high",
		)
	})

	it("treats an unrecognized value as Default", () => {
		expect(savedReasoningEffort(ProviderConfigResponse.create({ providerId: "openai", reasoningEffort: "max" }))).toBe(
			"default",
		)
	})
})

describe("reasoningEffortPatch", () => {
	it("clears the saved setting for Default", () => {
		expect(reasoningEffortPatch("default")).toEqual({ clearReasoning: true })
	})

	it("disables reasoning for None", () => {
		expect(reasoningEffortPatch("none")).toEqual({ reasoning: { enabled: false, effort: "none" } })
	})

	it("enables reasoning at the chosen level", () => {
		expect(reasoningEffortPatch("medium")).toEqual({ reasoning: { enabled: true, effort: "medium" } })
	})
})
