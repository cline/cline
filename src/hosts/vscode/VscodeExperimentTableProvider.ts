import type { Controller } from "@core/controller"
import * as vscode from "vscode"
import { listSessionIds, loadExperimentSurface } from "@/integrations/aihydro-session/sessionSurfaces"

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
			console.warn(
				"[VscodeExperimentTableProvider] No main webview instance — local experiment loading still works; gRPC forwarding disabled",
			)
		}

		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: unknown) => panel.webview.postMessage(response)
				switch (message.type) {
					case "grpc_request":
						if (message.grpc_request && mainWebview) {
							await handleGrpcRequest(mainWebview.controller, postMessageToWebview, message.grpc_request)
						}
						break
					case "grpc_request_cancel":
						if (message.grpc_request_cancel) {
							await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
						}
						break
					case "list_sessions":
						panel.webview.postMessage({ type: "session_list", sessions: listSessionIds() })
						break
					case "load_experiment":
						VscodeExperimentTableProvider.handleLoadExperiment(
							panel,
							message.session_id,
							message.experiment_id,
							message.request_tag,
						)
						break
					case "open_replay":
						{
							const { VscodeReplayProvider } = require("@/hosts/vscode/VscodeReplayProvider")
							void VscodeReplayProvider.openWithSession(
								String(message.session_id ?? ""),
								String(message.run_id ?? "") || undefined,
							)
						}
						break
					case "highlight_experiment_feature":
						VscodeExperimentTableProvider.handleHighlightFeature(message.feature_id)
						break
					default:
						break
				}
			},
			null,
			VscodeExperimentTableProvider.disposables,
		)
	}

	private static handleHighlightFeature(featureId: string | null | undefined): void {
		const controller = VscodeExperimentTableProvider.controller
		if (!controller) {
			return
		}

		// Clear selection when featureId is null/undefined
		if (!featureId) {
			controller.mapSessionService.appendEvent({
				type: "command.fit_extent",
				payloadJson: "{}",
				timestampMs: Date.now(),
				source: "user",
			})
			return
		}

		// Find the best matching layer: prefer one whose metadata.feature_id or name
		// contains the featureId string (gauge IDs like "01109000" are substrings of
		// layer names like "Watershed 01109000").
		const layers = controller.getMapLayers()
		const match = layers.find(
			(l) => l.metadata?.feature_id === featureId || l.name?.includes(featureId) || l.id?.includes(featureId),
		)

		if (match) {
			controller.mapSessionService.appendEvent({
				type: "command.fit_layer",
				payloadJson: JSON.stringify({ layerId: match.id }),
				timestampMs: Date.now(),
				source: "user",
			})
		} else {
			// No matching layer — open the map and fit all layers so the user at least
			// sees the map workspace and can load the relevant session.
			controller.mapSessionService.appendEvent({
				type: "command.fit_extent",
				payloadJson: "{}",
				timestampMs: Date.now(),
				source: "user",
			})
		}

		// Ensure the map panel is visible
		try {
			const { VscodeMapPanelProvider } = require("@/hosts/vscode/VscodeMapPanelProvider")
			void VscodeMapPanelProvider.createOrShow()
		} catch {
			/* map panel may not exist in test builds */
		}
	}

	private static handleLoadExperiment(
		panel: vscode.WebviewPanel,
		sessionId: string,
		experimentId?: string,
		requestTag?: string,
	): void {
		// request_tag round-trips whatever the webview sent (e.g. "compare") so
		// it can route this response to a different piece of state (comparing
		// a second experiment) without a second message type or touching the
		// primary load_experiment/experiment_table_data contract.
		const tag = requestTag ? { request_tag: String(requestTag) } : {}
		try {
			if (!sessionId?.trim()) {
				panel.webview.postMessage({
					type: "experiment_table_error",
					message:
						"Enter a session_id/path. Experiment id is optional; the first available experiment will load automatically.",
					...tag,
				})
				return
			}

			const exp = loadExperimentSurface(sessionId.trim(), String(experimentId ?? "").trim())
			panel.webview.postMessage({
				type: "experiment_table_data",
				session_id: exp.session_id,
				experiment_id: exp.experiment_id,
				defn: exp.defn,
				results: exp.results,
				available_experiment_ids: exp.availableExperimentIds,
				session_path: exp.sessionPath,
				...tag,
			})
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			if (msg.startsWith("No experiments found")) {
				panel.webview.postMessage({
					type: "experiment_table_empty",
					message: `${msg} This is normal for single-gauge analyses that have replay runs/signatures but no explicit experiment matrix yet.`,
					...tag,
				})
				return
			}
			console.error("[VscodeExperimentTableProvider] load_experiment error:", msg)
			panel.webview.postMessage({
				type: "experiment_table_error",
				message: `Failed to load experiment: ${msg}`,
				...tag,
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
		if (typeof window.CSSStyleSheet === "undefined") {
			window.CSSStyleSheet = function CSSStyleSheet() {};
		}
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
