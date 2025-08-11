import { WebviewProviderType } from "@/shared/webview/types"
import { WebviewProvider } from "@/core/webview"
import * as vscode from "vscode"
import { URI } from "vscode-uri"

export class ExternalWebviewProvider extends WebviewProvider {
	// This hostname cannot be changed without updating the external webview handler.
	private RESOURCE_HOSTNAME: string = "internal.resources"

	constructor(context: vscode.ExtensionContext, providerType: WebviewProviderType) {
		super(context, providerType)
	}

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
	override getWebview() {
		return {}
	}

	override resolveWebviewView(_: any): Promise<void> {
		return Promise.resolve()
	}
}
