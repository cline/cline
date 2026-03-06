import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { DEFAULT_MAX_LINES, formatFileContentWithLineNumbers } from "../ReadFileToolHandler"

describe("formatFileContentWithLineNumbers", () => {
	describe("line labels", () => {
		it("adds 1-indexed line prefixes", () => {
			const result = formatFileContentWithLineNumbers("alpha\nbeta")
			assert.ok(result.startsWith("L1: alpha\nL2: beta"))
		})

		it("does not add an extra numbered line for trailing newline", () => {
			const result = formatFileContentWithLineNumbers("alpha\nbeta\n")
			assert.ok(result.startsWith("L1: alpha\nL2: beta"))
			assert.ok(!result.includes("L3:"))
		})

		it("returns empty content unchanged", () => {
			const result = formatFileContentWithLineNumbers("")
			assert.equal(result, "")
		})
	})

	describe("chunked reads", () => {
		const tenLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n")

		it("defaults to reading from line 1", () => {
			const result = formatFileContentWithLineNumbers(tenLines)
			assert.ok(result.startsWith("L1: line1\n"))
		})

		it("respects start_line parameter", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 5)
			assert.ok(result.startsWith("L5: line5\n"))
			assert.ok(!result.includes("L4:"))
		})

		it("respects start_line and end_line parameters", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 3, 5)
			assert.ok(result.startsWith("L3: line3\n"))
			assert.ok(result.includes("L4: line4\n"))
			assert.ok(result.includes("L5: line5"))
			assert.ok(!result.includes("L2:"))
			assert.ok(!result.includes("L6:"))
		})

		it("clamps start_line to 1 if below", () => {
			const result = formatFileContentWithLineNumbers(tenLines, -5, 3)
			assert.ok(result.startsWith("L1: line1\n"))
		})

		it("clamps end_line to total lines if beyond", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 8, 999)
			assert.ok(result.includes("L10: line10"))
			assert.ok(!result.includes("L11:"))
		})
	})

	describe("continuation hints", () => {
		const tenLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n")

		it("shows continuation hint when more lines remain", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 1, 5)
			assert.ok(result.includes("Showing lines 1-5 of 10 total"))
			assert.ok(result.includes("start_line=6"))
		})

		it("shows total-lines footer when entire file is returned", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 1, 10)
			assert.ok(result.includes("File has 10 lines total"))
		})

		it("shows total-lines footer when file fits within default limit", () => {
			const result = formatFileContentWithLineNumbers(tenLines)
			assert.ok(result.includes("File has 10 lines total"))
		})
	})

	describe("default max lines", () => {
		const bigContent = Array.from({ length: DEFAULT_MAX_LINES + 500 }, (_, i) => `row${i + 1}`).join("\n")

		it("limits output to DEFAULT_MAX_LINES when no end_line given", () => {
			const result = formatFileContentWithLineNumbers(bigContent)
			assert.ok(result.includes(`L1: row1`))
			assert.ok(result.includes(`L${DEFAULT_MAX_LINES}: row${DEFAULT_MAX_LINES}`))
			assert.ok(!result.includes(`L${DEFAULT_MAX_LINES + 1}:`))
			assert.ok(result.includes(`start_line=${DEFAULT_MAX_LINES + 1}`))
		})

		it("allows reading beyond default limit with explicit end_line", () => {
			const endLine = DEFAULT_MAX_LINES + 200
			const result = formatFileContentWithLineNumbers(bigContent, 1, endLine)
			assert.ok(result.includes(`L${endLine}: row${endLine}`))
		})
	})

	describe("byte truncation interaction", () => {
		it("preserves truncation notice without numbering it", () => {
			const input =
				"alpha\nbeta\n\n---\n\n[FILE TRUNCATED: This content is 1.0 MB but only the first 400 KB is shown (600 KB truncated).]"
			const result = formatFileContentWithLineNumbers(input)
			assert.ok(result.startsWith("L1: alpha\nL2: beta"))
			assert.ok(
				result.includes(
					"[FILE TRUNCATED: This content is 1.0 MB but only the first 400 KB is shown (600 KB truncated).]",
				),
			)
			assert.ok(!result.includes("L3:"))
		})
	})
})
