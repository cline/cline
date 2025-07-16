import { getHostBridgeProvider } from "@/hosts/host-providers"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

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
		_currentLine: number,
	): Promise<void> {
		await getHostBridgeProvider().diffClient.replaceText({
			diffId: this.activeDiffEditorId,
			content: content,
			startLine: rangeToReplace.startLine,
			endLine: rangeToReplace.endLine,
		})
	}
	override setCursor(line: number, character: number): void {}
	override scrollToLine(line: number): void {}
	override async saveDocument(): Promise<void> {}
	override async getDocumentText(): Promise<string | undefined> {
		return ""
	}
	override async truncateDocument(lineNumber: number): Promise<void> {}
	override async revertDocument(): Promise<void> {}
	override async scrollAnimation(startLine: number, endLine: number): Promise<void> {}
	override async closeAllDiffViews(): Promise<void> {}
	override async resetDiffView(): Promise<void> {}
	override async getNewDiagnosticProblems(): Promise<string> {
		return ""
	}
}
