import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

export class ExternalDiffViewProvider extends DiffViewProvider {
	override async openDiffEditor(): Promise<void> {
		// The host bridge proto changes are not submitted yet.
		//getHostBridgeProvider().diffClient.openDiff(this.absolutePath)
	}
}
