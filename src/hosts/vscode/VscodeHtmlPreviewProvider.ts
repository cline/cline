import type { Controller } from "@core/controller"
import * as vscode from "vscode"
import type { ArtifactRef } from "@/services/artifact-preview/ArtifactPreviewService"
import { buildPreviewCsp } from "@/services/artifact-preview/buildPreviewCsp"

/**
 * Owns the single AI-Hydro HTML Preview webview panel.
 *
 * Architecture (post-redesign):
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  WebviewPanel "aihydroHtmlPreviewView"                           │
 *   │                                                                  │
 *   │  ┌───────── parent React shell (sidebar + toolbar) ─────────┐    │
 *   │  │  <iframe src={item.webviewUri} sandbox=…>                │    │
 *   │  │     ↑ artifact loaded directly from disk via             │    │
 *   │  │       webview.asWebviewUri() — same scheme VS Code       │    │
 *   │  │       uses for its built-in markdown preview.            │    │
 *   │  └──────────────────────────────────────────────────────────┘    │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * The parent webview's CSP and `localResourceRoots` are recomputed whenever
 * the artifact set changes, so newly-registered artifacts (especially inline
 * ones written to globalStorageUri) become loadable without re-creating the
 * panel.
 *
 * The provider does NOT keep its own copy of the artifact list — that lives
 * in `ArtifactPreviewService`, accessed via the controller.
 */
export class VscodeHtmlPreviewProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []
	private static currentNonce = ""

	public static initialize(context: vscode.ExtensionContext, controller: Controller): void {
		VscodeHtmlPreviewProvider.context = context
		VscodeHtmlPreviewProvider.controller = controller
	}

	public static isOpen(): boolean {
		return VscodeHtmlPreviewProvider.currentPanel !== undefined
	}

	public static async createOrShow(): Promise<void> {
		if (!VscodeHtmlPreviewProvider.context || !VscodeHtmlPreviewProvider.controller) {
			console.warn("[VscodeHtmlPreviewProvider] Not initialized — cannot open HTML preview panel")
			return
		}

		const column = vscode.ViewColumn.Two

		if (VscodeHtmlPreviewProvider.currentPanel) {
			VscodeHtmlPreviewProvider.currentPanel.reveal(column)
			VscodeHtmlPreviewProvider.refreshPanel()
			return
		}

		const panel = vscode.window.createWebviewPanel("aihydroHtmlPreviewView", "AI-Hydro HTML Preview", column, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: VscodeHtmlPreviewProvider.computeLocalResourceRoots(),
		})
		VscodeHtmlPreviewProvider.currentPanel = panel
		VscodeHtmlPreviewProvider.refreshPanel()
		VscodeHtmlPreviewProvider.setupMessageHandler(panel)

		// Re-render the panel HTML when the artifact set changes so that
		// `localResourceRoots` and CSP `frame-src` always cover whatever the
		// React shell may try to load next.
		const svc = VscodeHtmlPreviewProvider.controller.getArtifactPreviewService()
		const svcSub = svc.onChange(() => VscodeHtmlPreviewProvider.refreshPanel())
		VscodeHtmlPreviewProvider.disposables.push(svcSub)

		panel.onDidDispose(
			() => {
				VscodeHtmlPreviewProvider.currentPanel = undefined
				while (VscodeHtmlPreviewProvider.disposables.length) {
					const d = VscodeHtmlPreviewProvider.disposables.pop()
					d?.dispose()
				}
			},
			null,
			VscodeHtmlPreviewProvider.disposables,
		)
	}

	/**
	 * Resolve an `ArtifactRef` to a URL the inner iframe can load.
	 *
	 * The hash is appended as a cache-busting query string so that when the
	 * underlying file is updated (same path, new content), the iframe
	 * actually re-fetches instead of serving from disk cache.
	 */
	public static getArtifactWebviewUri(ref: ArtifactRef): { src: string; dir: string } {
		const panel = VscodeHtmlPreviewProvider.currentPanel
		if (!panel) {
			return { src: "", dir: "" }
		}
		const fileUri = vscode.Uri.file(ref.fsPath)
		const dirUri = vscode.Uri.file(ref.dirFsPath)
		const src = `${panel.webview.asWebviewUri(fileUri).toString()}?h=${ref.contentHash.slice(0, 12)}`
		const dir = panel.webview.asWebviewUri(dirUri).toString()
		return { src, dir }
	}

	/**
	 * Rebuild the panel's HTML, CSP, and `localResourceRoots` so newly
	 * registered artifacts (especially inline ones in globalStorageUri) can
	 * be loaded by the inner iframe.
	 */
	private static refreshPanel(): void {
		const panel = VscodeHtmlPreviewProvider.currentPanel
		if (!panel) return
		// Update accessible roots so asWebviewUri works for every artifact.
		panel.webview.options = {
			...panel.webview.options,
			enableScripts: true,
			localResourceRoots: VscodeHtmlPreviewProvider.computeLocalResourceRoots(),
		}
		// Build the React shell HTML. We need a fresh nonce on every (re)load
		// so the parent CSP can pin script execution.
		VscodeHtmlPreviewProvider.currentNonce = generateNonce()
		panel.webview.html = VscodeHtmlPreviewProvider.buildShellHtml(panel.webview, VscodeHtmlPreviewProvider.currentNonce)
		// Push fresh state so the webview's React app gets the new webviewUris.
		void VscodeHtmlPreviewProvider.controller?.postStateToWebview()
	}

	private static computeLocalResourceRoots(): vscode.Uri[] {
		const ctx = VscodeHtmlPreviewProvider.context
		const controller = VscodeHtmlPreviewProvider.controller
		const baseRoots: vscode.Uri[] = [
			vscode.Uri.joinPath(ctx.extensionUri, "webview-ui", "build"),
			vscode.Uri.joinPath(ctx.extensionUri, "node_modules", "@vscode", "codicons", "dist"),
		]
		const dynamic = controller?.getArtifactPreviewService().getLocalResourceRoots() ?? []
		return [...baseRoots, ...dynamic]
	}

	private static setupMessageHandler(panel: vscode.WebviewPanel): void {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.error("[VscodeHtmlPreviewProvider] No main webview instance — cannot route gRPC")
			return
		}

		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: any) => panel.webview.postMessage(response)
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
					case "aihydro-preview-event":
						// Phase 0: relay webview-side preview events into the
						// host's PreviewSessionService ring buffer. Phase 1 will
						// replace this postMessage path with a gRPC unary call
						// (PreviewServiceClient.reportPreviewEvent) and expose
						// MCP tools (preview_get_state, preview_recent_events).
						try {
							const svc = mainWebview.controller.previewSessionService
							const payload = (message.payloadJson ?? "{}") as string
							const parsed = (() => {
								try {
									return JSON.parse(payload) as Record<string, unknown>
								} catch {
									return {}
								}
							})()
							svc.appendEvent({
								moduleId: String(parsed.moduleId ?? parsed.module_id ?? "unknown"),
								cellId: typeof parsed.cellId === "string" ? parsed.cellId : undefined,
								kind: String(message.kind ?? "user.interaction"),
								payloadJson: payload,
								timestampMs: Number(message.timestampMs) || Date.now(),
								source: String(message.source ?? "user"),
							})
						} catch (err) {
							console.warn("[VscodeHtmlPreviewProvider] preview-event relay failed:", err)
						}
						break
					case "aihydro-preview-agent-task":
						// Phase 1 will start an agent chat task here using the
						// `prompt` field, mirroring the map agent-task path.
						// Phase 0 acknowledges receipt so the bridge promise
						// resolves cleanly instead of timing out.
						try {
							panel.webview.postMessage({
								type: "aihydro-preview-agent-result",
								requestId: message.requestId,
								ok: false,
								error: "agent task path lands in Phase 1",
							})
						} catch (err) {
							console.warn("[VscodeHtmlPreviewProvider] preview-agent-task ack failed:", err)
						}
						break
					default:
						console.warn("[VscodeHtmlPreviewProvider] Unhandled message:", JSON.stringify(message))
				}
			},
			null,
			VscodeHtmlPreviewProvider.disposables,
		)
	}

	private static buildShellHtml(webview: vscode.Webview, nonce: string): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeHtmlPreviewProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeHtmlPreviewProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		const csp = buildPreviewCsp({
			cspSource: webview.cspSource,
			nonce,
			// Always allow scripts at the shell level. Whether the iframe
			// itself executes scripts is gated by its `sandbox` attribute on
			// the React side, so we don't need a separate CSP build per item.
			allowScripts: true,
		})

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro HTML Preview</title>
	<style>
		html, body, #root { margin: 0; padding: 0; height: 100vh; width: 100vw; overflow: hidden; }
		.html-preview-standalone { width: 100%; height: 100%; }
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">
		window.AIHYDRO_HTML_PREVIEW_STANDALONE = true;
	</script>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
	}
}

function generateNonce(): string {
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	let text = ""
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}
