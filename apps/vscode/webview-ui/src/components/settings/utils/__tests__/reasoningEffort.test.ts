import { describe, expect, it } from "vitest"
import { reasoningEffortPatch } from "../reasoningEffort"

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
