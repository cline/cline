import { createHash } from "node:crypto"
import * as path from "node:path"
import * as vscode from "vscode"
import { type DetectedMode, detectMode } from "./detectMode"

/**
 * A single artifact tracked by the preview system.
 *
 * Invariants:
 *   • `fsPath` always points to a real, readable file on disk. Inline HTML
 *     coming from the `preview_html` tool is materialized to a file inside
 *     `globalStorageUri/html-artifacts/` so every artifact has a uniform
 *     render path.
 *   • `contentHash` is the SHA-256 of the file's bytes at registration time
 *     and is used (a) as a cache key for the iframe (`?h=<hash>`), and
 *     (b) by callers that want to know whether a re-registration changed
 *     the underlying content.
 */
export interface ArtifactRef {
	id: string
	title: string
	source: "file" | "inline"
	mode: DetectedMode
	fsPath: string
	dirFsPath: string
	contentHash: string
	createdAt: number
	/**
	 * Raw HTML of the artifact at registration time. Used by the webview
	 * to render via `<iframe srcdoc>`, which is the only reliable way to
	 * preview the content in a VS Code webview: `asWebviewUri()` serves
	 * the file from a *different* origin than the parent webview, so
	 * cross-origin frame blocking can render the iframe blank even when
	 * the response status is 200.
	 */
	html: string
	byteLength: number
	/** Free-form, persisted across the gRPC boundary. */
	metadata: Record<string, string>
}

/** Maximum on-disk artifact size we are willing to register. */
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024 // 50 MB

export type ArtifactChangeKind = "added" | "updated" | "removed" | "cleared"
export interface ArtifactChange {
	kind: ArtifactChangeKind
	ref?: ArtifactRef
}

/**
 * Owns the lifecycle of every artifact that can appear in the AI-Hydro HTML
 * Preview panel.
 *
 * Responsibilities:
 *   • Materialize inline HTML to disk so the preview pipeline only ever
 *     deals with real files.
 *   • Compute and cache a deterministic ID per artifact (so the same file
 *     registered twice does not create duplicates).
 *   • Detect whether scripts should be enabled by default.
 *   • Notify subscribers (the controller, the preview provider) when the
 *     set of artifacts changes.
 *
 * Deliberately stateless w.r.t. the webview: the service does NOT know
 * anything about VS Code WebviewPanels, CSP, or URI resolution. Those
 * concerns live in `VscodeHtmlPreviewProvider`.
 */
export class ArtifactPreviewService {
	private readonly artifacts = new Map<string, ArtifactRef>()
	private readonly listeners = new Set<(c: ArtifactChange) => void>()
	private readonly inlineDir: vscode.Uri

	constructor(private readonly context: vscode.ExtensionContext) {
		this.inlineDir = vscode.Uri.joinPath(context.globalStorageUri, "html-artifacts")
	}

	/** Register an HTML file already on disk (workspace file or absolute path). */
	async registerFile(opts: { fsPath: string; title?: string; preferredMode?: DetectedMode }): Promise<ArtifactRef> {
		const fileUri = vscode.Uri.file(path.resolve(opts.fsPath))
		const bytes = await vscode.workspace.fs.readFile(fileUri)
		this.assertSize(bytes.byteLength, fileUri.fsPath)
		const html = new TextDecoder("utf-8").decode(bytes)
		const ref = this.buildRef({
			fsPath: fileUri.fsPath,
			title: opts.title ?? path.basename(fileUri.fsPath),
			source: "file",
			html,
			preferredMode: opts.preferredMode,
		})
		this.upsert(ref)
		return ref
	}

	/**
	 * Register an inline HTML string by writing it to a stable on-disk path
	 * inside `globalStorageUri/html-artifacts/`. Reusing the same title
	 * overwrites the same file rather than producing duplicate artifacts.
	 */
	async registerInline(opts: { html: string; title?: string; preferredMode?: DetectedMode }): Promise<ArtifactRef> {
		const bytes = new TextEncoder().encode(opts.html)
		this.assertSize(bytes.byteLength, opts.title ?? "inline")
		await vscode.workspace.fs.createDirectory(this.inlineDir)
		const title = opts.title?.trim() || `inline_${Date.now()}`
		const safeBase = title.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80)
		const fileName = `${safeBase || "inline"}.html`
		const fileUri = vscode.Uri.joinPath(this.inlineDir, fileName)
		await vscode.workspace.fs.writeFile(fileUri, bytes)
		const ref = this.buildRef({
			fsPath: fileUri.fsPath,
			title,
			source: "inline",
			html: opts.html,
			preferredMode: opts.preferredMode,
		})
		this.upsert(ref)
		return ref
	}

	get(id: string): ArtifactRef | undefined {
		return this.artifacts.get(id)
	}

	list(): ArtifactRef[] {
		return Array.from(this.artifacts.values())
	}

	remove(id: string): boolean {
		const existing = this.artifacts.get(id)
		const removed = this.artifacts.delete(id)
		if (removed && existing) {
			this.emit({ kind: "removed", ref: existing })
		}
		return removed
	}

	clear(): void {
		if (this.artifacts.size === 0) return
		this.artifacts.clear()
		this.emit({ kind: "cleared" })
	}

	/** Root directories that need to be in the webview's `localResourceRoots`. */
	getLocalResourceRoots(): vscode.Uri[] {
		const roots = new Map<string, vscode.Uri>()
		roots.set(this.inlineDir.toString(), this.inlineDir)
		for (const a of this.artifacts.values()) {
			const dirUri = vscode.Uri.file(a.dirFsPath)
			roots.set(dirUri.toString(), dirUri)
		}
		for (const wf of vscode.workspace.workspaceFolders ?? []) {
			roots.set(wf.uri.toString(), wf.uri)
		}
		return Array.from(roots.values())
	}

	onChange(cb: (c: ArtifactChange) => void): vscode.Disposable {
		this.listeners.add(cb)
		return new vscode.Disposable(() => this.listeners.delete(cb))
	}

	// ─── Internals ─────────────────────────────────────────────────────────

	private buildRef(args: {
		fsPath: string
		title: string
		source: "file" | "inline"
		html: string
		preferredMode?: DetectedMode
	}): ArtifactRef {
		const contentHash = createHash("sha256").update(args.html).digest("hex")
		const id = `${args.source}_${createHash("sha1").update(args.fsPath).digest("hex").slice(0, 16)}`
		const mode = args.preferredMode ?? detectMode(args.html)
		return {
			id,
			title: args.title,
			source: args.source,
			mode,
			fsPath: args.fsPath,
			dirFsPath: path.dirname(args.fsPath),
			contentHash,
			createdAt: Date.now(),
			html: args.html,
			byteLength: args.html.length,
			metadata: {
				timestamp: new Date().toISOString(),
				source: args.source,
				contentType: "text/html",
				detectedMode: mode,
				byteLength: String(args.html.length),
			},
		}
	}

	private upsert(ref: ArtifactRef): void {
		const existing = this.artifacts.get(ref.id)
		this.artifacts.set(ref.id, ref)
		this.emit({ kind: existing ? "updated" : "added", ref })
	}

	private emit(change: ArtifactChange): void {
		for (const cb of this.listeners) {
			try {
				cb(change)
			} catch (err) {
				console.error("[ArtifactPreviewService] listener threw:", err)
			}
		}
	}

	private assertSize(byteLength: number, label: string): void {
		if (byteLength > MAX_ARTIFACT_BYTES) {
			const mb = (byteLength / 1024 / 1024).toFixed(1)
			throw new Error(`Artifact too large (${mb} MB > ${MAX_ARTIFACT_BYTES / 1024 / 1024} MB): ${label}`)
		}
	}
}
