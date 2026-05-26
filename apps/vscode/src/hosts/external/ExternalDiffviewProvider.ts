import { status } from "@grpc/grpc-js"
import { HostProvider } from "@/hosts/host-provider"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { Logger } from "@/shared/services/Logger"

export class ExternalDiffViewProvider extends DiffViewProvider {
	private activeDiffEditorId: string | undefined

	override async openDiffEditor(): Promise<void> {
		if (!this.absolutePath) {
			return
		}
		const response = await HostProvider.diff.openDiff({
			path: this.absolutePath,
			content: this.originalContent ?? "",
		})
		this.activeDiffEditorId = response.diffId
	}

	override async replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		_currentLine: number | undefined,
	): Promise<void> {
		if (!this.activeDiffEditorId) {
			return
		}
		await HostProvider.diff.replaceText({
			diffId: this.activeDiffEditorId,
			content: content,
			startLine: rangeToReplace.startLine,
			endLine: rangeToReplace.endLine,
		})
	}

	protected override async truncateDocument(lineNumber: number): Promise<void> {
		if (!this.activeDiffEditorId) {
			return
		}
		await HostProvider.diff.truncateDocument({
			diffId: this.activeDiffEditorId,
			endLine: lineNumber,
		})
	}

	protected override async getDocumentLineCount(): Promise<number> {
		const text = await this.getDocumentText()
		if (!text) {
			return 0
		}
		// Count lines: split by newline, but handle trailing newline correctly
		const lines = text.split("\n")
		// If text ends with newline, split creates an extra empty string at the end
		// which represents the "line" after the final newline - this is correct line count
		return lines.length
	}

	protected async saveDocument(): Promise<Boolean> {
		if (!this.activeDiffEditorId) {
			return false
		}
		try {
			await HostProvider.diff.saveDocument({ diffId: this.activeDiffEditorId })
			return true
		} catch (err: any) {
			if (err.code === status.NOT_FOUND) {
				// This can happen when the task is reloaded or the diff editor is closed. So, don't
				// consider it a real error.
				Logger.log("Diff not found:", this.activeDiffEditorId)
				return false
			} else {
				throw err
			}
		}
	}

	protected override async scrollEditorToLine(line: number): Promise<void> {
		if (!this.activeDiffEditorId) {
			return
		}
		await HostProvider.diff.scrollDiff({ diffId: this.activeDiffEditorId, line: line })
	}

	override async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {}

	protected override async getDocumentText(): Promise<string | undefined> {
		if (!this.activeDiffEditorId) {
			return undefined
		}
		try {
			return (await HostProvider.diff.getDocumentText({ diffId: this.activeDiffEditorId })).content
		} catch (err) {
			Logger.log("Error getting contents of diff editor", err)
			return undefined
		}
	}

	protected override async closeAllDiffViews(): Promise<void> {
		await HostProvider.diff.closeAllDiffs({})
		this.activeDiffEditorId = undefined
	}

	protected override async resetDiffView(): Promise<void> {
		this.activeDiffEditorId = undefined
	}
}
