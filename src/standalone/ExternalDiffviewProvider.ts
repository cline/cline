import { getHostBridgeProvider } from "@/hosts/host-providers"
import { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

export class ExternalDiffViewProvider extends DiffViewProvider {
	override async openDiffEditor(): Promise<void> {
		if (!this.absolutePath) {
			return
		}
		getHostBridgeProvider().diffClient.openDiff({ path: this.absolutePath, content: this.originalContent ?? "" })
	}
}
