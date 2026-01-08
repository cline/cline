import * as assert from "assert"
import { describe, it } from "mocha"
import { DiffViewProvider } from "../DiffViewProvider"

class TestBoundaryDiffViewProvider extends DiffViewProvider {
	public documentText: string = ""
	public truncatedAt: number | undefined

	async openDiffEditor(): Promise<void> {}
	async scrollEditorToLine(line: number): Promise<void> {}
	async scrollAnimation(startLine: number, endLine: number): Promise<void> {}

	async truncateDocument(lineNumber: number): Promise<void> {
		this.truncatedAt = lineNumber
		const lines = this.documentText.split("\n")
		if (lineNumber < lines.length) {
			this.documentText = lines.slice(0, lineNumber).join("\n")
		}
	}

	async getDocumentLineCount(): Promise<number> {
		return this.documentText.split("\n").length
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
		// Minimal implementation for update() to work
		const lines = this.documentText.split("\n")
		const newLines = content.split("\n")
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
		this.truncatedAt = undefined
	}
}

describe("DiffViewProvider Boundary Validation", () => {
	it("should replace entire document on final update to prevent concatenation", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Start with multi-line content
		provider.setup("line1\nline2\nline3\n")

		// Update with content that has no trailing newline
		// This previously caused "Hello World" + "line2" concatenation
		await provider.update("Hello World", true)

		const result = await provider.getDocumentText()
		// Should be just "Hello World", not "Hello Worldline2\nline3\n"
		assert.strictEqual(result, "Hello World")
	})

	it("safelyTruncateDocument should no-op when lineNumber >= lineCount", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		provider.setup("line1\nline2\nline3")
		// lineCount is 3

		// Access private method via any cast or just call update which calls it
		// But update calls it with streamedLines.length.
		// Let's use update to trigger it.

		// If we update with same content, streamedLines.length will be 3.
		// safelyTruncateDocument(3) should be called.
		// 3 >= 3, so it should NOT call truncateDocument.

		await provider.update("line1\nline2\nline3", true)

		assert.strictEqual(provider.truncatedAt, undefined, "Should not have called truncateDocument")
	})

	it("final update replaces entire document so truncation is no-op", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		provider.setup("line1\nline2\nline3")

		// Update with fewer lines
		await provider.update("line1\n", true)

		// With the fix, the final update replaces the entire document (0 to lineCount).
		// So replaceText handles all the content, and truncation becomes unnecessary.
		// The document should contain just "line1\n" and truncation should NOT be called
		// because after replaceText, the document already has the correct content.

		// Note: truncation might still be called but should be a no-op since document is already correct
		assert.strictEqual(provider.documentText, "line1\n")
	})

	it("update() with shorter content replaces entire document", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		provider.setup("line1\nline2\nline3\nline4")

		// Update with 2 lines
		await provider.update("line1\nline2", true)

		// With the fix, the final update replaces the entire document (0 to lineCount).
		// The document should contain just "line1\nline2".

		assert.strictEqual(provider.documentText, "line1\nline2")
	})
})
