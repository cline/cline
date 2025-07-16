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
	override setCursor(line: number, character: number): void {
		throw new Error("Method not implemented.")
	}
	override scrollToLine(line: number): void {
		throw new Error("Method not implemented.")
	}
	override saveDocument(): Promise<void> {
		throw new Error("Method not implemented.")
	}
	override getDocumentText(): Promise<string | undefined> {
		throw new Error("Method not implemented.")
	}
	override truncateDocument(lineNumber: number): Promise<void> {
		throw new Error("Method not implemented.")
	}
	override revertDocument(): Promise<void> {
		throw new Error("Method not implemented.")
	}
	override scrollAnimation(startLine: number, endLine: number): Promise<void> {
		throw new Error("Method not implemented.")
	}
	override closeAllDiffViews(): Promise<void> {
		throw new Error("Method not implemented.")
	}
	override resetDiffView(): Promise<void> {
		throw new Error("Method not implemented.")
	}
	override getNewDiagnosticProblems(): Promise<string> {
		throw new Error("Method not implemented.")
	}
}
