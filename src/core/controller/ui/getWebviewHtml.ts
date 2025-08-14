import { WebviewProvider } from "@/core/webview"
import { EmptyRequest, String } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Returns the HTML content of the webview.
 *
 * This is only used by the standalone service. The Vscode extension gets the HTML directly from the webview when it
 * resolved through `resolveWebviewView()`.
 */
export async function getWebviewHtml(_controller: Controller, _: EmptyRequest): Promise<String> {
	const webviewProvider = WebviewProvider.getLastActiveInstance()
	if (!webviewProvider) {
		throw new Error("No active webview")
	}
	return Promise.resolve(String.create({ value: webviewProvider.getHtmlContent() }))
}
