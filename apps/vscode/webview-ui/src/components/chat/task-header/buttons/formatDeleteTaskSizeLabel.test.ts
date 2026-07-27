import { describe, expect, it } from "vitest"
import { formatDeleteTaskSizeLabel } from "./formatDeleteTaskSizeLabel"

describe("formatDeleteTaskSizeLabel", () => {
	it("formats a zero byte task size", () => {
		expect(formatDeleteTaskSizeLabel(0)).toBe("0 B")
	})

	it("formats a non-zero task size", () => {
		expect(formatDeleteTaskSizeLabel(42)).toBe("42 B")
	})

	it("shows a placeholder when task size is unavailable", () => {
		expect(formatDeleteTaskSizeLabel()).toBe("--")
	})
})
