import assert from "node:assert/strict"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "mocha"
import { DEFAULT_MAX_LINES, formatFileContentWithLineNumbers, getReadToolDisplayedLineRange } from "../ReadFileToolHandler"

describe("getReadToolDisplayedLineRange", () => {
	const block = (start?: string, end?: string) => ({
		type: "tool_use" as const,
		name: ClineDefaultTool.FILE_READ,
		params: {
			path: "f.txt",
			...(start !== undefined ? { start_line: start } : {}),
			...(end !== undefined ? { end_line: end } : {}),
		},
		partial: false,
	})

	it("matches the slice shown for explicit start/end", () => {
		const text = Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join("\n")
		const r = getReadToolDisplayedLineRange(block("3", "5"), { text })
		assert.deepEqual(r, { start: 3, end: 5 })
	})

	it("returns undefined for image reads", () => {
		const r = getReadToolDisplayedLineRange(block(), {
			text: "ok",
			imageBlock: { type: "image", source: { type: "url", url: "x" } } as any,
		})
		assert.equal(r, undefined)
	})
})

describe("formatFileContentWithLineNumbers", () => {
	describe("line labels", () => {
		it("adds 1-indexed line prefixes", () => {
			const result = formatFileContentWithLineNumbers("alpha\nbeta")
			assert.ok(result.startsWith("1 | alpha\n2 | beta"))
		})

		it("does not add an extra numbered line for trailing newline", () => {
			const result = formatFileContentWithLineNumbers("alpha\nbeta\n")
			assert.ok(result.startsWith("1 | alpha\n2 | beta"))
			assert.ok(!result.includes("3 |"))
		})

		it("returns empty content unchanged", () => {
			const result = formatFileContentWithLineNumbers("")
			assert.equal(result, "")
		})
	})

	describe("chunked reads", () => {
		const tenLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n")
		const oversizedContent = Array.from({ length: DEFAULT_MAX_LINES + 10 }, (_, i) => `line${i + 1}`).join("\n")

		it("defaults to reading from line 1 and applies the default chunk size", () => {
			const result = formatFileContentWithLineNumbers(oversizedContent)
			assert.ok(result.startsWith("1 | line1\n"))
			assert.ok(result.includes(`${DEFAULT_MAX_LINES} | line${DEFAULT_MAX_LINES}`))
			assert.ok(!result.includes(`${DEFAULT_MAX_LINES + 1} |`))
			assert.ok(result.includes(`Showing lines 1-${DEFAULT_MAX_LINES} of ${DEFAULT_MAX_LINES + 10} total`))
			assert.ok(result.includes(`start_line=${DEFAULT_MAX_LINES + 1}`))
		})

		it("respects start_line parameter", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 5)
			assert.ok(result.startsWith("5 | line5\n"))
			assert.ok(!result.includes("4 |"))
		})

		it("respects start_line and end_line parameters", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 3, 5)
			assert.ok(result.startsWith("3 | line3\n"))
			assert.ok(result.includes("4 | line4\n"))
			assert.ok(result.includes("5 | line5"))
			assert.ok(!result.includes("2 |"))
			assert.ok(!result.includes("6 |"))
		})

		it("normalizes inverted start_line and end_line parameters", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 5, 3)
			assert.ok(result.startsWith("3 | line3\n"))
			assert.ok(result.includes("4 | line4\n"))
			assert.ok(result.includes("5 | line5"))
			assert.ok(!result.includes("2 |"))
			assert.ok(!result.includes("6 |"))
		})

		it("clamps start_line to 1 if below", () => {
			const result = formatFileContentWithLineNumbers(tenLines, -5, 3)
			assert.ok(result.startsWith("1 | line1\n"))
		})

		it("clamps end_line to total lines if beyond", () => {
			const result = formatFileContentWithLineNumbers(tenLines, 8, 999)
			assert.ok(result.includes("10 | line10"))
			assert.ok(!result.includes("11 |"))
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
			assert.ok(result.includes(`1 | row1`))
			assert.ok(result.includes(`${DEFAULT_MAX_LINES} | row${DEFAULT_MAX_LINES}`))
			assert.ok(!result.includes(`${DEFAULT_MAX_LINES + 1} |`))
			assert.ok(result.includes(`start_line=${DEFAULT_MAX_LINES + 1}`))
		})

		it("allows reading beyond default limit with explicit end_line", () => {
			const endLine = DEFAULT_MAX_LINES + 200
			const result = formatFileContentWithLineNumbers(bigContent, 1, endLine)
			assert.ok(result.includes(`${endLine} | row${endLine}`))
		})
	})

	describe("byte truncation interaction", () => {
		it("preserves truncation notice without numbering it", () => {
			const input =
				"alpha\nbeta\n\n---\n\n[FILE TRUNCATED: This content is 1.0 MB but only the first 400 KB is shown (600 KB truncated).]"
			const result = formatFileContentWithLineNumbers(input)
			assert.ok(result.startsWith("1 | alpha\n2 | beta"))
			assert.ok(
				result.includes(
					"[FILE TRUNCATED: This content is 1.0 MB but only the first 400 KB is shown (600 KB truncated).]",
				),
			)
			assert.ok(!result.includes("3 |"))
		})
	})
})
