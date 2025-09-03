import { URI } from "vscode-uri"
import { WebviewProvider } from "@/core/webview"

export class ExternalWebviewProvider extends WebviewProvider {
	// This hostname cannot be changed without updating the external webview handler.
	private RESOURCE_HOSTNAME: string = "internal.resources"

	override getWebviewUri(uri: URI) {
		if (uri.scheme !== "file") {
			return uri
		}
		return URI.from({ scheme: "https", authority: this.RESOURCE_HOSTNAME, path: uri.fsPath })
	}
	override getCspSource() {
		return `'self' https://${this.RESOURCE_HOSTNAME}`
	}
	override isVisible() {
		return true
	}
	protected override isActive(): boolean {
		return true
	}
}
