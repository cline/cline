import * as assert from "assert"
import { describe, it } from "mocha"
import { FileEditProvider } from "../integrations/editor/FileEditProvider"

describe("FileEditProvider Trailing Newline", () => {
	// Helper to set up provider without calling open()
	function setupProvider(initialContent: string): FileEditProvider {
		const provider = new FileEditProvider()
		provider["isEditing"] = true
		provider["documentContent"] = initialContent
		provider["originalContent"] = initialContent
		return provider
	}

	it("preserves trailing newline when content ends with newline", async () => {
		const provider = setupProvider("line1\nline2\n")

		await provider.replaceText("new1\nnew2\n", { startLine: 0, endLine: 2 }, undefined)
		const result = await provider.getContent()

		assert.strictEqual(result, "new1\nnew2\n")
		assert.strictEqual(result?.endsWith("\n"), true)
	})

	it("does not add trailing newline when content does not end with newline", async () => {
		const provider = setupProvider("line1\nline2")

		await provider.replaceText("new1\nnew2", { startLine: 0, endLine: 2 }, undefined)
		const result = await provider.getContent()

		assert.strictEqual(result, "new1\nnew2")
		assert.strictEqual(result?.endsWith("\n"), false)
	})

	it("preserves trailing newline when replacing middle section", async () => {
		const provider = setupProvider("line1\nline2\nline3\n")

		await provider.replaceText("new2\n", { startLine: 1, endLine: 2 }, undefined)
		const result = await provider.getContent()

		assert.strictEqual(result, "line1\nnew2\nline3\n")
		assert.strictEqual(result?.endsWith("\n"), true)
	})

	it("handles file without trailing newline correctly", async () => {
		const provider = setupProvider("line1\nline2")

		await provider.replaceText("new1\nnew2\n", { startLine: 0, endLine: 2 }, undefined)
		const result = await provider.getContent()

		assert.strictEqual(result, "new1\nnew2\n")
		assert.strictEqual(result?.endsWith("\n"), true)
	})
})
