import type { Controller } from "@core/controller"
import * as vscode from "vscode"
import { listSessionIds, loadReplaySurface } from "@/integrations/aihydro-session/sessionSurfaces"

/**
 * Owns the single AI-Hydro Session Replay webview panel.
 *
 * Architecture:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  WebviewPanel "aihydroSessionReplayView"                          │
 *   │                                                                  │
 *   │  Same webview-ui React bundle as the sidebar.                    │
 *   │  window.AIHYDRO_REPLAY_PANEL_STANDALONE = true tells             │
 *   │  App.tsx to render <ReplayPanel> instead of the chat UI.         │
 *   │                                                                  │
 *   │  A custom "load_replay" message reads the session JSON at        │
 *   │  ~/.aihydro/sessions/<session_id>.json and extracts _run_log,    │
 *   │  returning a "replay_data" payload to the webview.               │
 *   └──────────────────────────────────────────────────────────────────┘
 */
export class VscodeReplayProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []
	private static replayWebviewReady = false
	private static pendingInitialLoad: { sessionId: string; runId?: string } | undefined

	public static initialize(context: vscode.ExtensionContext, controller: Controller): void {
		VscodeReplayProvider.context = context
		VscodeReplayProvider.controller = controller
	}

	public static isOpen(): boolean {
		return VscodeReplayProvider.currentPanel !== undefined
	}

	public static async createOrShow(): Promise<void> {
		if (!VscodeReplayProvider.context || !VscodeReplayProvider.controller) {
			console.warn("[VscodeReplayProvider] Not initialized — cannot open Session Replay panel")
			return
		}

		const column = vscode.ViewColumn.Two

		if (VscodeReplayProvider.currentPanel) {
			VscodeReplayProvider.currentPanel.reveal(column)
			return
		}

		const panel = vscode.window.createWebviewPanel("aihydroSessionReplayView", "AI-Hydro Session Replay", column, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(VscodeReplayProvider.context.extensionUri, "webview-ui", "build"),
				vscode.Uri.joinPath(VscodeReplayProvider.context.extensionUri, "node_modules", "@vscode", "codicons", "dist"),
			],
		})

		VscodeReplayProvider.currentPanel = panel
		VscodeReplayProvider.replayWebviewReady = false
		panel.webview.html = VscodeReplayProvider.buildShellHtml(panel.webview)
		VscodeReplayProvider.setupMessageHandler(panel)

		panel.onDidDispose(
			() => {
				VscodeReplayProvider.currentPanel = undefined
				VscodeReplayProvider.replayWebviewReady = false
				VscodeReplayProvider.pendingInitialLoad = undefined
				while (VscodeReplayProvider.disposables.length) {
					const d = VscodeReplayProvider.disposables.pop()
					d?.dispose()
				}
			},
			null,
			VscodeReplayProvider.disposables,
		)
	}

	/** Open the replay panel and load a session once the webview reports readiness. */
	public static async openWithSession(sessionId: string, runId?: string): Promise<void> {
		const trimmedSessionId = sessionId.trim()
		if (!trimmedSessionId) {
			return
		}
		VscodeReplayProvider.pendingInitialLoad = { sessionId: trimmedSessionId, runId: runId?.trim() || undefined }
		await VscodeReplayProvider.createOrShow()
		VscodeReplayProvider.flushPendingInitialLoad()
	}

	private static flushPendingInitialLoad(): void {
		if (
			!VscodeReplayProvider.currentPanel ||
			!VscodeReplayProvider.replayWebviewReady ||
			!VscodeReplayProvider.pendingInitialLoad
		) {
			return
		}
		const { sessionId, runId } = VscodeReplayProvider.pendingInitialLoad
		VscodeReplayProvider.pendingInitialLoad = undefined
		VscodeReplayProvider.currentPanel.webview.postMessage({
			type: "load_replay",
			session_id: sessionId,
			focus_run_id: runId,
		})
	}

	private static setupMessageHandler(panel: vscode.WebviewPanel): void {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.warn(
				"[VscodeReplayProvider] No main webview instance — local replay loading still works; gRPC forwarding disabled",
			)
		}

		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: unknown) => panel.webview.postMessage(response)
				switch (message.type) {
					case "replay_ready":
						VscodeReplayProvider.replayWebviewReady = true
						VscodeReplayProvider.flushPendingInitialLoad()
						break
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
					case "load_replay":
						VscodeReplayProvider.handleLoadReplay(panel, message.session_id, message.focus_run_id)
						break
					default:
						break
				}
			},
			null,
			VscodeReplayProvider.disposables,
		)
	}

	private static handleLoadReplay(panel: vscode.WebviewPanel, sessionId: string, focusRunId?: string): void {
		const messageFocusRunId = focusRunId ? String(focusRunId) : undefined
		try {
			if (!sessionId?.trim()) {
				panel.webview.postMessage({ type: "replay_error", message: "session_id/path is required." })
				return
			}

			const replay = loadReplaySurface(sessionId.trim())
			panel.webview.postMessage({
				type: "replay_data",
				session_id: replay.session_id,
				source: replay.source,
				entries: replay.entries,
				focus_run_id: messageFocusRunId,
				session_path: replay.sessionPath,
				capsule_path: replay.capsule_path,
			})
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			console.error("[VscodeReplayProvider] load_replay error:", msg)
			panel.webview.postMessage({ type: "replay_error", message: `Failed to load replay: ${msg}` })
		}
	}

	private static buildShellHtml(webview: vscode.Webview): string {
		const nonce = generateNonce()
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeReplayProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeReplayProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro Session Replay</title>
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
		window.AIHYDRO_REPLAY_PANEL_STANDALONE = true;
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
