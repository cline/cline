import * as path from "node:path"
import { Empty } from "@shared/proto/cline/common"
import { HtmlPreviewMode, type PreviewHtmlRequest } from "@shared/proto/cline/html_preview"
import { ShowMessageType } from "@shared/proto/host/window"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from ".."

/**
 * Register an HTML artifact for preview.
 *
 * Two call patterns are supported, distinguished by whether `html_content`
 * or `file_path` is set:
 *
 *   1. INLINE — `html_content` is set: the string is written to a stable
 *      location under `globalStorageUri/html-artifacts/` so it can be
 *      served via `webview.asWebviewUri()` like any on-disk file.
 *
 *   2. FILE — `file_path` is set: an absolute or workspace-relative path
 *      to an existing `.html`/`.htm` file. The file is read once at
 *      registration time to compute its hash and detect interactive mode,
 *      but its contents are NOT shipped over gRPC. The webview iframe
 *      loads the file directly via `asWebviewUri`.
 *
 * The legacy `htmlContent` field on `HtmlPreviewItem` is intentionally
 * left empty in both cases; see `proto/cline/html_preview.proto`.
 */
export async function previewHtml(controller: Controller, request: PreviewHtmlRequest): Promise<Empty> {
	const svc = controller.getArtifactPreviewService()
	const title = request.title?.trim() || ""
	const filePath = request.filePath?.trim() || ""
	const html = request.htmlContent || ""

	// Translate the deprecated `interactive` bool + the new `mode` enum into
	// the service's two-state preference. Crucially, `mode === UNSPECIFIED`
	// (the proto3 default for an unset field) MUST fall through to
	// auto-detect via `detectMode()` — otherwise every untagged request
	// from the file tree would be pinned to `safe` and Folium/Plotly maps
	// would render as static HTML only (the legend visible, the map blank).
	let preferredMode: "safe" | "interactive" | undefined
	switch (request.mode) {
		case HtmlPreviewMode.INTERACTIVE:
			preferredMode = "interactive"
			break
		case HtmlPreviewMode.SAFE:
			preferredMode = "safe"
			break
		default:
			// UNSPECIFIED / EXTERNAL_BROWSER / unknown: honor the legacy
			// `interactive` bool if set, otherwise let auto-detect decide.
			preferredMode = request.interactive ? "interactive" : undefined
			break
	}

	try {
		let ref
		// When BOTH a file path and inline content are present (e.g. the
		// preview_html tool reads the file itself), prefer the on-disk file
		// so that sibling assets (./report_files/leaflet.css, etc.) resolve
		// relative to the original directory rather than to globalStorageUri.
		if (filePath) {
			const fsPath = await resolveFsPath(controller, filePath)
			// Early existence check — surface a friendlier toast than the
			// raw ENOENT path. Common cause: a stale entry in the preview
			// pile pointing at a file the agent listed but never actually
			// wrote (or that was moved/deleted after registration).
			try {
				const fsMod = await import("fs/promises")
				await fsMod.access(fsPath)
			} catch {
				HostProvider.window.showMessage({
					type: ShowMessageType.WARNING,
					message: `AI-Hydro HTML Preview: file not found at "${fsPath}". It may have been moved or deleted; remove it from the preview list if it's no longer needed.`,
				})
				return Empty.create()
			}
			ref = await svc.registerFile({ fsPath, title: title || path.basename(fsPath), preferredMode })
		} else if (html) {
			ref = await svc.registerInline({ html, title, preferredMode })
		} else {
			console.error("[previewHtml] Request has neither html_content nor file_path")
			HostProvider.window.showMessage({
				type: ShowMessageType.WARNING,
				message: "AI-Hydro HTML Preview: nothing to preview (request had no content or path).",
			})
			return Empty.create()
		}
		console.log(`[previewHtml] Registered artifact id=${ref.id} mode=${ref.mode} bytes=${ref.contentHash.length}`)
		controller.addHtmlPreview(ref)
		return Empty.create()
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error)
		console.error(`[previewHtml] Failed to register artifact:`, msg)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `AI-Hydro HTML Preview: ${msg}`,
		})
		throw error
	}
}

/**
 * Resolve a possibly-relative path against (in order): the controller's
 * workspace HTML file list (which already knows absolute URIs), the active
 * workspace folder, and the current working directory.
 */
async function resolveFsPath(controller: Controller, input: string): Promise<string> {
	if (path.isAbsolute(input)) {
		return input
	}
	const wsMatch = controller.getWorkspaceHtmlFiles().find((f) => f.relativePath === input)
	if (wsMatch) {
		return wsMatch.uri.fsPath
	}
	const folder = vscode.workspace.workspaceFolders?.[0]
	if (folder) {
		return path.join(folder.uri.fsPath, input)
	}
	return path.resolve(input)
}
