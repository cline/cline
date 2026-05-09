import type { Controller } from "@core/controller"
import * as vscode from "vscode"

export class VscodeMapPanelProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []

	public static initialize(context: vscode.ExtensionContext, controller: Controller) {
		VscodeMapPanelProvider.context = context
		VscodeMapPanelProvider.controller = controller
	}

	/** Returns true if the map panel is currently open (even if not visible). */
	public static isOpen(): boolean {
		return VscodeMapPanelProvider.currentPanel !== undefined
	}

	/**
	 * Send raw file bytes to the map webview for client-side parsing.
	 * Opens the panel first if it's not already visible.
	 * Called by the "Add to AI-Hydro Map" explorer context menu command.
	 */
	public static async sendFilesToMap(files: Array<{ name: string; data: Uint8Array }>): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		// Small delay to let the webview finish mounting before we push data
		await new Promise((resolve) => setTimeout(resolve, 400))
		for (const file of files) {
			await panel.webview.postMessage({
				type: "aihydro-load-file",
				name: file.name,
				// Transfer as plain number array so JSON serialization works
				data: Array.from(file.data),
			})
		}
	}

	public static async createOrShow() {
		if (!VscodeMapPanelProvider.context) {
			console.warn("[VscodeMapPanelProvider] Not yet initialized — cannot open map panel")
			return
		}

		const column = vscode.ViewColumn.Two

		// If we already have a panel, show it
		if (VscodeMapPanelProvider.currentPanel) {
			VscodeMapPanelProvider.currentPanel.reveal(column)
			return
		}

		// Otherwise, create a new panel
		const panel = vscode.window.createWebviewPanel("aihydroMapView", "AI-Hydro Map", column, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build")],
		})

		VscodeMapPanelProvider.currentPanel = panel

		// Set the webview's HTML content
		panel.webview.html = VscodeMapPanelProvider.getHtmlForWebview(panel.webview)

		// CRITICAL: Set up message handler so this panel can communicate with the extension
		VscodeMapPanelProvider.setupMessageHandler(panel)

		// Handle disposal
		panel.onDidDispose(
			() => {
				VscodeMapPanelProvider.currentPanel = undefined
				// Clean up disposables
				while (VscodeMapPanelProvider.disposables.length) {
					const x = VscodeMapPanelProvider.disposables.pop()
					if (x) {
						x.dispose()
					}
				}
			},
			null,
			[],
		)
	}

	/**
	 * Sets up message handling between the webview panel and the extension
	 * This allows the map panel to receive layer updates from the backend
	 */
	private static setupMessageHandler(panel: vscode.WebviewPanel) {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		// Get the main webview instance to access the controller
		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.error("[VscodeMapPanelProvider] Cannot set up message handler: no main webview instance")
			return
		}

		// Set up message listener for this panel
		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: any) => panel.webview.postMessage(response)

				switch (message.type) {
					case "grpc_request": {
						if (message.grpc_request) {
							await handleGrpcRequest(mainWebview.controller, postMessageToWebview, message.grpc_request)
						}
						break
					}
					case "grpc_request_cancel": {
						if (message.grpc_request_cancel) {
							await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
						}
						break
					}
					default: {
						console.error("[VscodeMapPanelProvider] Received unhandled message type:", JSON.stringify(message))
					}
				}
			},
			null,
			VscodeMapPanelProvider.disposables,
		)
	}

	private static getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none';
		style-src ${webview.cspSource} 'unsafe-inline';
		script-src 'nonce-${nonce}';
		img-src ${webview.cspSource} https: data: blob:;
		font-src ${webview.cspSource} https: data:;
		connect-src https: ${webview.cspSource};
		worker-src blob:;">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro Map</title>
	<style>
		body {
			margin: 0;
			padding: 0;
			overflow: hidden;
			width: 100vw;
			height: 100vh;
		}
		#root {
			width: 100%;
			height: 100%;
		}
		.map-standalone {
			width: 100%;
			height: 100%;
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">
		// Set standalone map mode flag
		window.AIHYDRO_MAP_STANDALONE = true;
	</script>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
	}
}

function getNonce() {
	let text = ""
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}
