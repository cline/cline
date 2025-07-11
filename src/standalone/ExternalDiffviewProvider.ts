import { getHostBridgeProvider } from "@/hosts/host-providers"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"
import * as iconv from "iconv-lite"
import * as fs from "fs/promises"
export class ExternalDiffViewProvider extends DiffViewProvider {
	override async openDiffEditor(): Promise<void> {
		//getHostBridgeProvider().workspaceClient.openDiff(this.absolutePath)
	}
	override setCursor(line: number, character: number): void {
		//getHostBridgeProvider()...
	}
	override scrollToLine(line: number): void {
		//getHostBridgeProvider()...
	}
	override async saveDocument(): Promise<void> {
		//getHostBridgeProvider()...
	}
	override async getDocumentText(): Promise<string | undefined> {
		//getHostBridgeProvider()...
		if (!this.absolutePath) {
			return undefined
		}
		const fileBuffer = await fs.readFile(this.absolutePath)
		return iconv.decode(fileBuffer, this.fileEncoding)
	}
	override async replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number,
	): Promise<void> {
		//getHostBridgeProvider()...
	}
	override async truncateDocument(lineNumber: number): Promise<void> {
		//getHostBridgeProvider()...
	}
	override async revertDocument(): Promise<void> {
		//getHostBridgeProvider()...
	}
	override async getNewDiagnosticProblems(): Promise<string> {
		return ""
	}
	override async scrollAnimation(startLine: number, endLine: number): Promise<void> {}
	override async closeAllDiffViews(): Promise<void> {
		//getHostBridgeProvider()...
	}
	override async resetDiffView(): Promise<void> {}
}
