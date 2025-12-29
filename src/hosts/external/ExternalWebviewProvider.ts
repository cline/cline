import { sendSettingsButtonClickedEvent } from "@/core/controller/ui/subscribeToSettingsButtonClicked"
import { WebviewProvider } from "@/core/webview"

export class ExternalWebviewProvider extends WebviewProvider {
	// This hostname cannot be changed without updating the external webview handler.
	private RESOURCE_HOSTNAME: string = "internal.resources"

	override getWebviewUrl(path: string) {
		const url = new URL(`https://${this.RESOURCE_HOSTNAME}/`)
		url.pathname = path
		return url.toString()
	}
	override getCspSource() {
		return `'self' https://${this.RESOURCE_HOSTNAME}`
	}
	override isVisible() {
		return true
	}

	override canOpenSettingsInSeparateWindow(): boolean {
		// JetBrains/CLI currently doesn't support separate windows
		// This could be enhanced in the future via host bridge protocol
		return false
	}

	override async openSettingsInSeparateWindow(): Promise<void> {
		// Fall back to in-pane navigation for platforms that don't support separate windows
		await sendSettingsButtonClickedEvent()
	}
}
