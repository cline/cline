import { describe, expect, it } from "vitest"
import { normalizeOpenaiReasoningEffort, OPENAI_REASONING_EFFORT_OPTIONS } from "@/shared/storage/types"

describe("normalizeOpenaiReasoningEffort", () => {
	it("includes max in the selectable effort options", () => {
		expect(OPENAI_REASONING_EFFORT_OPTIONS).toContain("max")
	})

	it("preserves max reasoning effort", () => {
		expect(normalizeOpenaiReasoningEffort("max")).toBe("max")
	})

	it("normalizes uppercase max reasoning effort", () => {
		expect(normalizeOpenaiReasoningEffort("MAX")).toBe("max")
	})
})
