import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

export class ExternalDiffViewProvider extends DiffViewProvider {
	override async openDiffEditor(): Promise<void> {
		//getHostBridgeProvider().diffClient.openDiff(this.absolutePath)
	}
}
