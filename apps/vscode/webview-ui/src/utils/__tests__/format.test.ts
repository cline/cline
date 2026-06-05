import { describe, expect, it } from "vitest"
import { formatContextWindow } from "../format"

describe("formatContextWindow", () => {
	it("formats token context windows as compact labels", () => {
		expect(formatContextWindow(200_000)).toBe("200K")
		expect(formatContextWindow(1_000_000)).toBe("1M")
		expect(formatContextWindow(1_048_576)).toBe("1M")
		expect(formatContextWindow(1_500_000)).toBe("1.5M")
	})

	it("handles missing or invalid context windows", () => {
		expect(formatContextWindow()).toBe("N/A")
		expect(formatContextWindow(0)).toBe("N/A")
	})
})
