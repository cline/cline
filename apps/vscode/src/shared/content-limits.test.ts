import { describe, expect, it } from "vitest"
import { truncateContent } from "./content-limits"

describe("truncateContent", () => {
	it("returns content unchanged when it is under the byte limit", () => {
		expect(truncateContent("hello", 100)).toBe("hello")
	})

	it("limits by UTF-8 bytes, not UTF-16 code units", () => {
		const content = "中".repeat(1000) // 1000 code units, 3000 UTF-8 bytes
		const out = truncateContent(content, 500)
		const shown = out.split("\n\n---\n\n")[0]
		expect(new TextEncoder().encode(shown).length).toBeLessThanOrEqual(500)
	})

	it("never splits a multi-byte character", () => {
		const content = "a" + "😀".repeat(50)
		const out = truncateContent(content, 10)
		const shown = out.split("\n\n---\n\n")[0]
		expect(shown.includes("\uFFFD")).toBe(false)
		expect(new TextEncoder().encode(shown).length).toBeLessThanOrEqual(10)
	})
})
