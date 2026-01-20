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

		// Check if we're replacing to the end of the document
		const replacingToEnd = rangeToReplace.endLine >= lines.length

		const newLines = content.split("\n")

		// Remove trailing empty line for proper splicing, BUT only when NOT replacing
		// to the end of the document. When replacing to the end, keep the trailing
		// empty string to preserve trailing newlines from the content.
		if (!replacingToEnd && newLines[newLines.length - 1] === "") {
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

describe("DiffViewProvider content finalization with isFinal=true", () => {
	// Tests verifying that update(content, true) properly finalizes the document.
	// This is the fix for the approval flow bug: FileProviderOperations now always
	// passes isFinal=true to update() to ensure proper document finalization.

	it("should handle large file with deleted lines (1000 -> 997 lines)", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Original file has 1000 lines
		const originalLines = Array.from({ length: 1000 }, (_, i) => `line${i + 1}`).join("\n")
		provider.setup(originalLines)

		// New content has 997 lines (simulating deleted lines 994-996)
		const newContent = [
			...Array.from({ length: 993 }, (_, i) => `line${i + 1}`),
			"line997",
			"line998",
			"line999",
			"line1000",
		].join("\n")

		// Update with isFinal=true ensures proper document finalization
		// (full range replacement + truncation)
		await provider.update(newContent, true)

		const result = await provider.getDocumentText()
		const resultLines = result?.split("\n") || []

		// Should have exactly 997 lines matching newContent, no duplicates
		assert.strictEqual(resultLines.length, 997, "Should have 997 lines")

		// First lines should match
		assert.strictEqual(resultLines[0], "line1")
		assert.strictEqual(resultLines[992], "line993")

		// Last 4 lines should be line997-line1000, not duplicated
		assert.strictEqual(resultLines[993], "line997")
		assert.strictEqual(resultLines[994], "line998")
		assert.strictEqual(resultLines[995], "line999")
		assert.strictEqual(resultLines[996], "line1000")
	})

	it("should handle simple content reduction (4 -> 2 lines)", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		provider.setup("line1\nline2\nline3\nline4")

		await provider.update("newA\nnewB", true)

		const result = await provider.getDocumentText()
		// Should be just "newA\nnewB", not corrupted with old content
		assert.strictEqual(result, "newA\nnewB")
	})

	it("should preserve trailing newline when reducing content", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		provider.setup("line1\nline2\nline3\n")

		await provider.update("new1\nnew2\n", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "new1\nnew2\n", "Should preserve trailing newline")
	})
})

describe("DiffViewProvider Newline Preservation", () => {
	it("preserves trailing newline when content ends with newline", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Original file has trailing newline
		provider.setup("line1\nline2\n")

		// New content also has trailing newline
		await provider.update("new1\nnew2\n", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "new1\nnew2\n", "Trailing newline should be preserved")
		assert.strictEqual(result?.endsWith("\n"), true)
	})

	it("does not add trailing newline when content does not end with newline", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Original file has trailing newline
		provider.setup("line1\nline2\n")

		// New content does NOT have trailing newline
		await provider.update("new1\nnew2", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "new1\nnew2", "Should not have trailing newline")
		assert.strictEqual(result?.endsWith("\n"), false)
	})

	it("adds trailing newline when content ends with newline but original did not", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Original file does NOT have trailing newline
		provider.setup("line1\nline2")

		// New content has trailing newline
		await provider.update("new1\nnew2\n", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "new1\nnew2\n", "Should add trailing newline")
		assert.strictEqual(result?.endsWith("\n"), true)
	})

	it("preserves no trailing newline when neither original nor new content has one", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Original file does NOT have trailing newline
		provider.setup("line1\nline2")

		// New content also does NOT have trailing newline
		await provider.update("new1\nnew2", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "new1\nnew2", "Should not have trailing newline")
		assert.strictEqual(result?.endsWith("\n"), false)
	})

	it("handles shortening file while preserving trailing newline", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Original: 10 lines with trailing newline
		provider.setup("line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n")

		// New: 3 lines with trailing newline
		await provider.update("line1\nline2\nline3\n", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "line1\nline2\nline3\n", "Should shorten and preserve trailing newline")
	})

	it("handles lengthening file while preserving trailing newline", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		// Original: 3 lines with trailing newline
		provider.setup("line1\nline2\nline3\n")

		// New: 5 lines with trailing newline
		await provider.update("line1\nline2\nline3\nline4\nline5\n", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "line1\nline2\nline3\nline4\nline5\n", "Should lengthen and preserve trailing newline")
	})

	it("handles single line content with trailing newline", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		provider.setup("old content\n")

		await provider.update("Hello World\n", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "Hello World\n")
	})

	it("handles single line content without trailing newline", async () => {
		const provider = new TestBoundaryDiffViewProvider()
		provider.setup("old content\nline2\n")

		await provider.update("Hello World", true)

		const result = await provider.getDocumentText()
		assert.strictEqual(result, "Hello World")
	})
})
