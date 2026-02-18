import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { addLineNumbersToReadFileContent } from "../ReadFileToolHandler"

describe("ReadFileToolHandler line numbering", () => {
	it("adds codex-style 1-indexed line prefixes", () => {
		const result = addLineNumbersToReadFileContent("alpha\nbeta")
		assert.equal(result, "L1: alpha\nL2: beta")
	})

	it("does not add an extra numbered line for trailing newline", () => {
		const result = addLineNumbersToReadFileContent("alpha\nbeta\n")
		assert.equal(result, "L1: alpha\nL2: beta")
	})

	it("preserves truncation notice without numbering it", () => {
		const input =
			"alpha\nbeta\n\n---\n\n[FILE TRUNCATED: This content is 1.0 MB but only the first 400 KB is shown (600 KB truncated).]"
		const result = addLineNumbersToReadFileContent(input)

		assert.equal(
			result,
			"L1: alpha\nL2: beta\n\n---\n\n[FILE TRUNCATED: This content is 1.0 MB but only the first 400 KB is shown (600 KB truncated).]",
		)
	})

	it("returns empty content unchanged", () => {
		const result = addLineNumbersToReadFileContent("")
		assert.equal(result, "")
	})
})
