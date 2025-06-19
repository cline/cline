import { ExtensionMessage } from "@/shared/ExtensionMessage"
import { WebviewProviderType } from "@/shared/webview/types"
import { sendThemeEvent } from "@core/controller/ui/subscribeToTheme"
import { getTheme } from "@integrations/theme/getTheme"
import * as vscode from "vscode"
import { Uri } from "vscode"
import { WebviewProvider } from "@core/webview"

/*
https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
*/

export class ExternalWebviewProvider extends WebviewProvider {
	public webview?: vscode.WebviewView | vscode.WebviewPanel

	public static create(
		context: vscode.ExtensionContext,
		outputChannel: vscode.OutputChannel,
		providerType: WebviewProviderType,
	) {
		return new ExternalWebviewProvider(context, outputChannel, providerType)
	}

	constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel, providerType: WebviewProviderType) {
		super(context, outputChannel, providerType)
	}

	override getWebviewUri(uri: Uri) {
		return uri.with({
			scheme: "http",
			authority: "resources",
		})
	}
	override getCspSource() {
		return "csp-source"
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

	override resolveWebviewView(_: vscode.WebviewView | vscode.WebviewPanel): Promise<void> {
		return Promise.resolve()
	}
}
