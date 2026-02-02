import { describe, expect, it } from "vitest"
import { computeDiff, getGutterWidth } from "../DiffComputer"

describe("DiffComputer", () => {
	describe("computeDiff", () => {
		it("should compute diff for SEARCH/REPLACE format with changes", () => {
			const content = `------- SEARCH
function hello() {
  console.log("hello")
}
=======
function hello() {
  console.log("hello, world!")
}
+++++++ REPLACE`

			const diff = computeDiff(content)

			expect(diff.blocks).toHaveLength(1)
			expect(diff.totalDeletions).toBeGreaterThan(0)
			expect(diff.totalAdditions).toBeGreaterThan(0)

			// Should have context lines for unchanged parts
			const contextLines = diff.blocks[0].lines.filter((l) => l.type === "context")
			expect(contextLines.length).toBeGreaterThan(0)

			// Should have the changed line
			const removeLines = diff.blocks[0].lines.filter((l) => l.type === "remove")
			const addLines = diff.blocks[0].lines.filter((l) => l.type === "add")
			expect(removeLines.some((l) => l.content.includes('"hello"'))).toBe(true)
			expect(addLines.some((l) => l.content.includes('"hello, world!"'))).toBe(true)
		})

		it("should handle streaming (incomplete SEARCH block)", () => {
			const content = `------- SEARCH
function hello() {
  console.log("hello")`

			const diff = computeDiff(content)

			expect(diff.blocks).toHaveLength(1)
			expect(diff.totalDeletions).toBeGreaterThan(0)
			expect(diff.totalAdditions).toBe(0) // No replace block yet
		})

		it("should handle multiple SEARCH/REPLACE blocks", () => {
			const content = `------- SEARCH
const a = 1
=======
const a = 2
+++++++ REPLACE
------- SEARCH
const b = 3
=======
const b = 4
+++++++ REPLACE`

			const diff = computeDiff(content)

			expect(diff.blocks).toHaveLength(2)
			expect(diff.totalDeletions).toBe(2)
			expect(diff.totalAdditions).toBe(2)
		})

		it("should handle new file (all additions)", () => {
			const content = `line 1
line 2
line 3`

			const diff = computeDiff(content)

			expect(diff.blocks).toHaveLength(1)
			expect(diff.totalAdditions).toBe(3)
			expect(diff.totalDeletions).toBe(0)
			expect(diff.blocks[0].lines.every((l) => l.type === "add")).toBe(true)
		})

		it("should assign line numbers correctly", () => {
			const content = `------- SEARCH
line 1
line 2
=======
line 1
new line
line 2
+++++++ REPLACE`

			const diff = computeDiff(content)
			const lines = diff.blocks[0].lines

			// Context lines should have both old and new line numbers
			const contextLines = lines.filter((l) => l.type === "context")
			for (const line of contextLines) {
				expect(line.oldLineNumber).toBeDefined()
				expect(line.newLineNumber).toBeDefined()
			}

			// Add lines should have new line numbers
			const addLines = lines.filter((l) => l.type === "add")
			for (const line of addLines) {
				expect(line.newLineNumber).toBeDefined()
			}
		})
	})

	describe("getGutterWidth", () => {
		it("should return correct width for single digit line numbers", () => {
			const diff = computeDiff("line 1\nline 2\nline 3")
			expect(getGutterWidth(diff)).toBe(1)
		})

		it("should return correct width for double digit line numbers", () => {
			const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n")
			const diff = computeDiff(lines)
			expect(getGutterWidth(diff)).toBe(2)
		})
	})
})
