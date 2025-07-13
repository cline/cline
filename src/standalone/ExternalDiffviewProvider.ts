import { getHostBridgeProvider } from "@/hosts/host-providers"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

export class ExternalDiffViewProvider extends DiffViewProvider {
	override async openDiffEditor(): Promise<void> {
		if (!this.absolutePath) {
			return
		}
		getHostBridgeProvider().diffClient.openDiff({ path: this.absolutePath, content: this.originalContent ?? "" })
	}
	override replaceText(
		content: string,
		rangeToReplace: { startLine: number; endLine: number },
		currentLine: number,
	): Promise<void> {
		throw new Error("Method not implemented.")
	}
}
