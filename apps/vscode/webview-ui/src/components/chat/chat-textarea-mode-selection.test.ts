import { describe, expect, it } from "vitest"
import { getModeChange } from "./chat-textarea-mode-selection"

describe("getModeChange", () => {
	it("does not change mode when the selected segment is clicked", () => {
		expect(getModeChange("plan", "plan")).toBeUndefined()
		expect(getModeChange("act", "act")).toBeUndefined()
	})

	it("changes to the other selected segment", () => {
		expect(getModeChange("plan", "act")).toBe("act")
		expect(getModeChange("act", "plan")).toBe("plan")
	})
})
