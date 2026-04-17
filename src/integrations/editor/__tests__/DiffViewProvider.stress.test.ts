import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import { measureAsyncOperation } from "@/test/stress-utils"
import { DiffViewProvider } from "../DiffViewProvider"

class SoakDiffViewProvider extends DiffViewProvider {
	public documentText = ""
	public openCount = 0
	public replaceCount = 0
	public resetCount = 0

	async openDiffEditor(): Promise<void> {
		this.openCount += 1
	}

	async scrollEditorToLine(_line: number): Promise<void> {}
	async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {}

	async truncateDocument(lineNumber: number): Promise<void> {
		const lines = this.documentText.split("\n")
		this.documentText = lines.slice(0, lineNumber).join("\n")
	}

	async getDocumentLineCount(): Promise<number> {
		return this.documentText.split("\n").length
	}

	async getDocumentText(): Promise<string | undefined> {
		return this.documentText
	}

	async saveDocument(): Promise<boolean> {
		return true
	}

	async closeAllDiffViews(): Promise<void> {}

	async resetDiffView(): Promise<void> {
		this.resetCount += 1
		this.documentText = ""
	}

	async replaceText(
		content: string,
		_rangeToReplace: { startLine: number; endLine: number },
		_currentLine: number | undefined,
	): Promise<void> {
		this.replaceCount += 1
		this.documentText = content
	}

	public beginSyntheticEdit(initialContent: string) {
		this.isEditing = true
		this.originalContent = initialContent
		this.documentText = initialContent
	}
}

describe("DiffViewProvider soak", () => {
	it("handles 1,000 repeated diff-edit open/update/reset cycles within a bounded budget", async function () {
		this.timeout(20_000)

		const provider = new SoakDiffViewProvider()
		const original = Array.from({ length: 200 }, (_, i) => `line${i + 1}-${"payload".repeat(8)}`).join("\n")
		const updated = `${original}\ncycle-tail`

		const measured = await measureAsyncOperation("diff view open/update/reset soak", async () => {
			for (let cycle = 0; cycle < 1_000; cycle++) {
				provider.beginSyntheticEdit(original)
				await provider.openDiffEditor()
				await provider.update(updated, true)
				await provider.reset()
			}

			return {
				openCount: provider.openCount,
				replaceCount: provider.replaceCount,
				resetCount: provider.resetCount,
			}
		})

		assert.deepStrictEqual(measured.result, {
			openCount: 1_000,
			replaceCount: 1_000,
			resetCount: 1_000,
		})
		assert.equal(provider.isEditing, false)
		assert.equal(provider.documentText, "")
		assert.ok(measured.durationMs < 20_000)
		assert.ok(measured.diff.heapUsedDelta < 128 * 1024 * 1024)
	})
})
