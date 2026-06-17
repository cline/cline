import { describe, expect, it } from "vitest"
import { getUserTypeSelections, NEW_USER_TYPE } from "../data-steps"

describe("getUserTypeSelections", () => {
	it("omits the Cline Pass option when the flag is disabled", () => {
		const selections = getUserTypeSelections(false)
		expect(selections.map((s) => s.type)).toEqual([NEW_USER_TYPE.FREE, NEW_USER_TYPE.POWER, NEW_USER_TYPE.BYOK])
		expect(selections.some((s) => s.type === NEW_USER_TYPE.CLINE_PASS)).toBe(false)
	})

	it("inserts Cline Pass right after the free option when the flag is enabled", () => {
		const selections = getUserTypeSelections(true)
		// Free stays first (and remains the default selection); Cline Pass is the
		// recommended-but-optional second choice.
		expect(selections[0]?.type).toBe(NEW_USER_TYPE.FREE)
		expect(selections[1]?.type).toBe(NEW_USER_TYPE.CLINE_PASS)
		expect(selections.map((s) => s.type)).toEqual([
			NEW_USER_TYPE.FREE,
			NEW_USER_TYPE.CLINE_PASS,
			NEW_USER_TYPE.POWER,
			NEW_USER_TYPE.BYOK,
		])
	})
})
