import type { Controller } from "@core/controller"
import * as vscode from "vscode"

/**
 * Owns the single AI-Hydro Evidence Board webview panel.
 *
 * Architecture:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  WebviewPanel "aihydroEvidenceBoardView"                         │
 *   │                                                                  │
 *   │  Same webview-ui React bundle as the sidebar.                    │
 *   │  window.AIHYDRO_EVIDENCE_BOARD_STANDALONE = true tells           │
 *   │  App.tsx to render <EvidenceBoard> instead of the chat UI.       │
 *   │                                                                  │
 *   │  gRPC messages are forwarded to the main webview controller so   │
 *   │  LedgerContext works identically to the sidebar.                 │
 *   └──────────────────────────────────────────────────────────────────┘
 */
export class VscodeEvidenceBoardProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []

	public static initialize(context: vscode.ExtensionContext, controller: Controller): void {
		VscodeEvidenceBoardProvider.context = context
		VscodeEvidenceBoardProvider.controller = controller
	}

	public static isOpen(): boolean {
		return VscodeEvidenceBoardProvider.currentPanel !== undefined
	}

	public static async createOrShow(): Promise<void> {
		if (!VscodeEvidenceBoardProvider.context || !VscodeEvidenceBoardProvider.controller) {
			console.warn("[VscodeEvidenceBoardProvider] Not initialized — cannot open Evidence Board panel")
			return
		}

		const column = vscode.ViewColumn.Two

		if (VscodeEvidenceBoardProvider.currentPanel) {
			VscodeEvidenceBoardProvider.currentPanel.reveal(column)
			return
		}

		const panel = vscode.window.createWebviewPanel("aihydroEvidenceBoardView", "AI-Hydro Evidence Board", column, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(VscodeEvidenceBoardProvider.context.extensionUri, "webview-ui", "build"),
				vscode.Uri.joinPath(
					VscodeEvidenceBoardProvider.context.extensionUri,
					"node_modules",
					"@vscode",
					"codicons",
					"dist",
				),
			],
		})

		VscodeEvidenceBoardProvider.currentPanel = panel
		panel.webview.html = VscodeEvidenceBoardProvider.buildShellHtml(panel.webview)
		VscodeEvidenceBoardProvider.setupMessageHandler(panel)

		panel.onDidDispose(
			() => {
				VscodeEvidenceBoardProvider.currentPanel = undefined
				while (VscodeEvidenceBoardProvider.disposables.length) {
					const d = VscodeEvidenceBoardProvider.disposables.pop()
					d?.dispose()
				}
			},
			null,
			VscodeEvidenceBoardProvider.disposables,
		)
	}

	private static setupMessageHandler(panel: vscode.WebviewPanel): void {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.error("[VscodeEvidenceBoardProvider] No main webview instance — cannot route gRPC")
			return
		}

		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: unknown) => panel.webview.postMessage(response)
				switch (message.type) {
					case "grpc_request":
						if (message.grpc_request) {
							await handleGrpcRequest(mainWebview.controller, postMessageToWebview, message.grpc_request)
						}
						break
					case "grpc_request_cancel":
						if (message.grpc_request_cancel) {
							await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
						}
						break
					default:
						break
				}
			},
			null,
			VscodeEvidenceBoardProvider.disposables,
		)
	}

	private static buildShellHtml(webview: vscode.Webview): string {
		const nonce = generateNonce()
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeEvidenceBoardProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeEvidenceBoardProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro Evidence Board</title>
	<style>
		html, body, #root { margin: 0; padding: 0; height: 100vh; width: 100vw; overflow: hidden; }
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">
		window.AIHYDRO_EVIDENCE_BOARD_STANDALONE = true;
	</script>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
	}
}

function generateNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	let text = ""
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length))
	}
	return text
}
