/**
 * Preview ↔ Host ↔ Agent bridge — webview-side helpers.
 *
 * Mirrors `webview-ui/src/components/map/mapSessionBridge.ts` and
 * `webview-ui/src/components/map/mapAgentBridge.ts`.
 *
 * Phase 0 (current): postMessage-based stubs.
 *  - `reportPreviewEvent()` posts `aihydro-preview-event` to the parent webview
 *    which relays it to the extension host via `VscodeHtmlPreviewProvider`.
 *  - `startPreviewAgentTask()` posts `aihydro-preview-agent-task` and waits for
 *    `aihydro-preview-agent-result`.
 *
 * Phase 1: a `PreviewServiceClient.reportPreviewEvent()` gRPC unary call will
 *   replace the postMessage relay so events flow through the standard service
 *   surface (same shape as `MapServiceClient.reportMapEvent`). The function
 *   signatures here will not change.
 */

import { PLATFORM_CONFIG } from "../../config/platform.config"

export type PreviewEventKind =
	| "cell.run.started"
	| "cell.run.completed"
	| "cell.output"
	| "cell.error"
	| "cell.registry"
	| "manifest.loaded"
	| "user.interaction"
	| "user.comment"
	| "map.event"
	| "edit.toggled"

export interface PreviewEventPayload {
	moduleId?: string
	cellId?: string
	[key: string]: unknown
}

function newRequestId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Fire-and-forget preview event telemetry to the extension host.
 *
 * Phase 0: posts via PLATFORM_CONFIG.postMessage so the parent webview shell
 *   relays to VscodeHtmlPreviewProvider's onDidReceiveMessage handler.
 * Phase 1: will switch to gRPC unary (PreviewServiceClient.reportPreviewEvent).
 */
export function reportPreviewEvent(kind: PreviewEventKind, payload: PreviewEventPayload = {}, source: string = "user"): void {
	try {
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-preview-event",
			kind,
			payloadJson: JSON.stringify(payload),
			timestampMs: Date.now(),
			source,
		})
	} catch (err) {
		// Never throw from telemetry — keep the iframe alive.
		console.warn("[previewBridge] reportPreviewEvent failed:", err)
	}
}

/**
 * Post the edited HTML to the extension host for disk persistence.
 * The host's `VscodeHtmlPreviewProvider` handles `aihydro-save-document`
 * by calling `vscode.workspace.fs.writeFile(filePath, html)`.
 */
export function requestSaveDocument(filePath: string, html: string): void {
	try {
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-save-document",
			filePath,
			html,
		})
	} catch (err) {
		console.warn("[previewBridge] requestSaveDocument failed:", err)
	}
}

/**
 * Start an agent task from the preview (e.g. "address this comment", "fix
 * the cell that failed"). Focuses the chat sidebar so the user sees the
 * agent take over.
 *
 * Mirrors `mapAgentBridge.startMapAgentTask` — host handles initTask().
 */
export function startPreviewAgentTask(prompt: string): Promise<{ ok: boolean; error?: string }> {
	const requestId = newRequestId("preview-agent")
	return new Promise((resolve) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			resolve({ ok: false, error: "Timed out waiting for agent task to start" })
		}, 60_000)

		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-preview-agent-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			resolve({ ok: Boolean(data.ok), error: data.error })
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-preview-agent-task",
			requestId,
			prompt,
		})
	})
}
