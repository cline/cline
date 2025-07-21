import { getHostBridgeProvider } from "@/hosts/host-providers"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import { status } from "@grpc/grpc-js"

export class ExternalDiffViewProvider extends DiffViewProvider {
	private activeDiffEditorId: string | undefined

	override async openDiffEditor(): Promise<void> {
		if (!this.absolutePath) {
			return
		}
		const response = await getHostBridgeProvider().diffClient.openDiff({
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
		await getHostBridgeProvider().diffClient.replaceText({
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
		await getHostBridgeProvider().diffClient.truncateDocument({
			diffId: this.activeDiffEditorId,
			endLine: lineNumber,
		})
	}

	protected async saveDocument(): Promise<Boolean> {
		if (!this.activeDiffEditorId) {
			return false
		}
		try {
			await getHostBridgeProvider().diffClient.saveDocument({ diffId: this.activeDiffEditorId })
			return true
		} catch (err: any) {
			if (err.code === status.NOT_FOUND) {
				// This can happen when the task is reloaded or the diff editor is closed. So, don't
				// consider it a real error.
				console.log("Diff not found:", this.activeDiffEditorId)
				return false
			} else {
				throw err
			}
		}
	}

	protected override async scrollEditorToLine(_line: number): Promise<void> {}

	override async scrollAnimation(_startLine: number, _endLine: number): Promise<void> {}

	protected override async getDocumentText(): Promise<string | undefined> {
		if (!this.activeDiffEditorId) {
			return undefined
		}
		return (await getHostBridgeProvider().diffClient.getDocumentText({ diffId: this.activeDiffEditorId })).content
	}

	protected override async getNewDiagnosticProblems(): Promise<string> {
		console.log(`Called ExternalDiffViewProvider.getNewDiagnosticProblems() stub`)
		return ""
	}

	protected override async closeDiffView(): Promise<void> {
		if (!this.activeDiffEditorId) {
			return
		}
		await getHostBridgeProvider().diffClient.closeDiff({ diffId: this.activeDiffEditorId })
		this.activeDiffEditorId = undefined
	}

	protected override async resetDiffView(): Promise<void> {
		this.activeDiffEditorId = undefined
	}
}
