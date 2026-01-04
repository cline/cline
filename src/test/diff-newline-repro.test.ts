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
})
