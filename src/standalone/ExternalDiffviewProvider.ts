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

	protected override async scrollEditorToLine(line: number): Promise<void> {
		console.log(`Called ExternalDiffViewProvider.scrollEditorToLine(${line}) stub`)
	}

	override async scrollAnimation(startLine: number, endLine: number): Promise<void> {
		console.log(`Called ExternalDiffViewProvider.scrollAnimation(${startLine}, ${endLine}) stub`)
	}
}
