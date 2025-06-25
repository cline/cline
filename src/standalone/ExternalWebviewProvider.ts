import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { WebviewProviderType } from "@/shared/webview/types"
import * as vscode from "vscode"
import { URI } from "vscode-uri"
import { WebviewProvider } from "@core/webview"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class ExternalWebviewProvider extends WebviewProvider {
	// This hostname cannot be changed without updating the external webview handler.
	private RESOURCE_HOSTNAME: string = "internal.resources"

	constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel, providerType: WebviewProviderType) {
		super(context, outputChannel, providerType)
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
	override postMessageToWebview(message: ExtensionMessage) {
		console.log(`postMessageToWebview: ${message}`)
		return undefined
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
