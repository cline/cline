import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { Controller } from "@core/controller"
import * as vscode from "vscode"

/**
 * Owns the single AI-Hydro Experiment Table webview panel.
 *
 * Architecture:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  WebviewPanel "aihydroExperimentTableView"                        │
 *   │                                                                  │
 *   │  Same webview-ui React bundle as the sidebar.                    │
 *   │  window.AIHYDRO_EXPERIMENT_TABLE_STANDALONE = true tells         │
 *   │  App.tsx to render <ExperimentTable> instead of the chat UI.     │
 *   │                                                                  │
 *   │  gRPC messages are forwarded to the main webview controller.     │
 *   │  A custom "load_experiment" message type reads the session JSON  │
 *   │  at ~/.aihydro/sessions/<session_id>.json and returns the        │
 *   │  experiment design + results without a Python round-trip.        │
 *   └──────────────────────────────────────────────────────────────────┘
 */
export class VscodeExperimentTableProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []

	public static initialize(context: vscode.ExtensionContext, controller: Controller): void {
		VscodeExperimentTableProvider.context = context
		VscodeExperimentTableProvider.controller = controller
	}

	public static isOpen(): boolean {
		return VscodeExperimentTableProvider.currentPanel !== undefined
	}

	public static async createOrShow(): Promise<void> {
		if (!VscodeExperimentTableProvider.context || !VscodeExperimentTableProvider.controller) {
			console.warn("[VscodeExperimentTableProvider] Not initialized — cannot open Experiment Table panel")
			return
		}

		const column = vscode.ViewColumn.Two

		if (VscodeExperimentTableProvider.currentPanel) {
			VscodeExperimentTableProvider.currentPanel.reveal(column)
			return
		}

		const panel = vscode.window.createWebviewPanel("aihydroExperimentTableView", "AI-Hydro Experiment Table", column, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(VscodeExperimentTableProvider.context.extensionUri, "webview-ui", "build"),
				vscode.Uri.joinPath(
					VscodeExperimentTableProvider.context.extensionUri,
					"node_modules",
					"@vscode",
					"codicons",
					"dist",
				),
			],
		})

		VscodeExperimentTableProvider.currentPanel = panel
		panel.webview.html = VscodeExperimentTableProvider.buildShellHtml(panel.webview)
		VscodeExperimentTableProvider.setupMessageHandler(panel)

		panel.onDidDispose(
			() => {
				VscodeExperimentTableProvider.currentPanel = undefined
				while (VscodeExperimentTableProvider.disposables.length) {
					const d = VscodeExperimentTableProvider.disposables.pop()
					d?.dispose()
				}
			},
			null,
			VscodeExperimentTableProvider.disposables,
		)
	}

	private static setupMessageHandler(panel: vscode.WebviewPanel): void {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.error("[VscodeExperimentTableProvider] No main webview instance — cannot route gRPC")
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
					case "load_experiment":
						VscodeExperimentTableProvider.handleLoadExperiment(panel, message.session_id, message.experiment_id)
						break
					default:
						break
				}
			},
			null,
			VscodeExperimentTableProvider.disposables,
		)
	}

	private static handleLoadExperiment(panel: vscode.WebviewPanel, sessionId: string, experimentId: string): void {
		try {
			if (!sessionId || !experimentId) {
				panel.webview.postMessage({
					type: "experiment_table_error",
					message: "session_id and experiment_id are required.",
				})
				return
			}

			const sessionPath = path.join(os.homedir(), ".aihydro", "sessions", `${sessionId}.json`)
			if (!fs.existsSync(sessionPath)) {
				panel.webview.postMessage({
					type: "experiment_table_error",
					message: `Session '${sessionId}' not found at ${sessionPath}`,
				})
				return
			}

			const raw = JSON.parse(fs.readFileSync(sessionPath, "utf8"))

			// Session slot may be at top level or in a nested feature dict
			const expSlot = raw["_experiments"]
			if (!expSlot) {
				panel.webview.postMessage({
					type: "experiment_table_error",
					message: `No experiments found in session '${sessionId}'.`,
				})
				return
			}

			// Slot is stored as {data: {...}, meta: {...}}
			const expsMap: Record<string, unknown> =
				typeof expSlot === "object" && "data" in expSlot ? (expSlot as any).data : expSlot

			if (!expsMap[experimentId]) {
				const available = Object.keys(expsMap).join(", ") || "(none)"
				panel.webview.postMessage({
					type: "experiment_table_error",
					message: `Experiment '${experimentId}' not found. Available: ${available}`,
				})
				return
			}

			const exp = expsMap[experimentId] as { defn: unknown; results: unknown }
			panel.webview.postMessage({
				type: "experiment_table_data",
				experiment_id: experimentId,
				defn: exp.defn,
				results: exp.results,
			})
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			console.error("[VscodeExperimentTableProvider] load_experiment error:", msg)
			panel.webview.postMessage({
				type: "experiment_table_error",
				message: `Failed to load experiment: ${msg}`,
			})
		}
	}

	private static buildShellHtml(webview: vscode.Webview): string {
		const nonce = generateNonce()
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeExperimentTableProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeExperimentTableProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro Experiment Table</title>
	<style>
		html, body, #root { margin: 0; padding: 0; height: 100vh; width: 100vw; overflow: hidden; }
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">
		window.AIHYDRO_EXPERIMENT_TABLE_STANDALONE = true;
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
