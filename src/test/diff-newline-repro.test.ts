import * as assert from "assert"
import { describe, it } from "mocha"
import { DiffViewProvider } from "../integrations/editor/DiffViewProvider"

class TestDiffViewProvider extends DiffViewProvider {
	public documentText: string = ""
	public replacements: { content: string; range: { startLine: number; endLine: number } }[] = []

	async openDiffEditor(): Promise<void> {}
	async scrollEditorToLine(line: number): Promise<void> {}
	async scrollAnimation(startLine: number, endLine: number): Promise<void> {}
	async truncateDocument(lineNumber: number): Promise<void> {
		const lines = this.documentText.split("\n")
		this.documentText = lines.slice(0, lineNumber).join("\n")
	}
	async getDocumentText(): Promise<string | undefined> {
		return this.documentText
	}
	async saveDocument(): Promise<Boolean> {
		return true
	}
	async closeAllDiffViews(): Promise<void> {}
	async resetDiffView(): Promise<void> {}

	async replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number | undefined,
	): Promise<void> {
		this.replacements.push({ content, range: rangeToReplace })
		// Simulate the replacement
		const lines = this.documentText.split("\n")
		const newLines = content.split("\n")
		// Preserve trailing newline logic (simplified)
		if (!content.endsWith("\n") && newLines[newLines.length - 1] === "") {
			newLines.pop()
		}
		lines.splice(rangeToReplace.startLine, rangeToReplace.endLine - rangeToReplace.startLine, ...newLines)
		this.documentText = lines.join("\n")
	}

	public setup(initialContent: string) {
		this.isEditing = true
		this.documentText = initialContent
		this.originalContent = initialContent
	}
}

describe("DiffViewProvider Newline handling", () => {
	it("preserves trailing newline through update() when content ends with newline", async () => {
		const provider = new TestDiffViewProvider()
		provider.setup("line1\nline2\n")

		await provider.update("new1\nnew2\n", true)
		const result = await provider.getDocumentText()

		assert.strictEqual(result, "new1\nnew2\n")
		assert.strictEqual(result?.endsWith("\n"), true)
	})

	it("does not add trailing newline when content does not end with newline", async () => {
		const provider = new TestDiffViewProvider()
		provider.setup("line1\nline2")

		await provider.update("new1\nnew2", true)
		const result = await provider.getDocumentText()

		assert.strictEqual(result, "new1\nnew2")
		assert.strictEqual(result?.endsWith("\n"), false)
	})

	it("handles file without trailing newline correctly", async () => {
		const provider = new TestDiffViewProvider()
		provider.setup("[6]: http://chris.beams.io/posts/git-commit/#seven-rules")

		await provider.update("new content\n", true)
		const result = await provider.getDocumentText()

		assert.strictEqual(result, "new content\n")
		assert.strictEqual(result?.endsWith("\n"), true)
	})

	it("does not duplicate content when new content is shorter than original", async () => {
		// This test covers the bug where content from the end of the original file
		// would be duplicated/displaced when the new content has fewer lines.
		const provider = new TestDiffViewProvider()
		const originalContent = "line1\nline2\nline3\nline4\nline5\n"
		provider.setup(originalContent)

		// Replace entire file with shorter content
		await provider.update("new1\nnew2\nnew3\n", true)
		const result = await provider.getDocumentText()

		// Should only contain the new content, no old content leftover
		assert.strictEqual(result, "new1\nnew2\nnew3\n")
		assert.ok(!result?.includes("line4"), "Old content should not be present")
		assert.ok(!result?.includes("line5"), "Old content should not be present")
	})

	it("does not leave old content when replacing 20 lines with 5 lines (exact bug scenario)", async () => {
		// This is the exact scenario reported in production:
		// Original file has 20 lines, replaced with 5 lines
		// Bug: "original line 7" was appearing at the end of the file
		const provider = new TestDiffViewProvider()
		let originalContent = ""
		for (let i = 1; i <= 20; i++) {
			originalContent += `original line ${i}\n`
		}
		provider.setup(originalContent)

		// Replace entire file with 5 lines
		await provider.update("new1\nnew2\nnew3\nnew4\nnew5\n", true)
		const result = await provider.getDocumentText()

		// Should only contain the 5 new lines
		assert.strictEqual(result, "new1\nnew2\nnew3\nnew4\nnew5\n")
		// Critical: NO original content should remain
		assert.ok(!result?.includes("original"), "Original content should not be present")
	})

	it("handles streaming updates correctly without content duplication", async () => {
		const provider = new TestDiffViewProvider()
		const originalContent = "original1\noriginal2\noriginal3\noriginal4\noriginal5\n"
		provider.setup(originalContent)

		// Simulate streaming: multiple non-final updates followed by a final update
		await provider.update("new1\n", false) // streaming
		await provider.update("new1\nnew2\n", false) // streaming
		await provider.update("new1\nnew2\nnew3\n", true) // final

		const result = await provider.getDocumentText()

		// Should only contain the final new content
		assert.strictEqual(result, "new1\nnew2\nnew3\n")
		assert.ok(!result?.includes("original"), "Original content should not be present")
	})
})
