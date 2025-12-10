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
}
