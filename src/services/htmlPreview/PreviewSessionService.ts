/**
 * Host-owned HTML Preview session: event ring buffer, manifest snapshot,
 * cell registry — mirrors `src/services/map/MapSessionService.ts`.
 *
 * Phase 0 (initial): in-memory accumulator + subscriber fan-out.
 *
 * Phase 1 (current): also mirrors session + events to disk so the Python
 *   MCP server (which can't hold a gRPC connection back into the extension)
 *   can read the state via the file-bridge pattern used elsewhere
 *   (see `~/.aihydro/map_session.json`, `~/.aihydro/map_events/outbound/`).
 *
 *   - `~/.aihydro/preview_session/<moduleId>.json`     — latest snapshot
 *   - `~/.aihydro/preview_events/<moduleId>/<seq>.json` — per-event records
 *
 *   The corresponding MCP tools (`preview_get_state`, `preview_recent_events`,
 *   `preview_focus_cell`, `preview_revise_section`) live in
 *   `aihydro-tools/ai_hydro/mcp/tools_preview.py`.
 *
 * Phase 4: comment store integration for `user.comment` events.
 */

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
	addComment as commentStoreAdd,
	updateComment as commentStoreUpdate,
	type TextAnchor,
} from "@/services/comments/commentStore"

const MAX_EVENTS = 500
const MAX_DISK_EVENTS_PER_MODULE = 200

const PREVIEW_SESSION_DIR = path.join(os.homedir(), ".aihydro", "preview_session")
const PREVIEW_EVENTS_DIR = path.join(os.homedir(), ".aihydro", "preview_events")

export interface PreviewEvent {
	eventId: string
	moduleId: string
	cellId?: string
	kind: string
	payloadJson: string
	timestampMs: number
	eventSeq: number
	source: string
}

export interface PreviewManifest {
	moduleId: string
	title?: string
	authors?: Array<{ name: string; affiliation?: string; orcid?: string | null }>
	version?: string
	license?: string
	citation?: { text?: string; doi?: string }
	agentObservable?: boolean
	[key: string]: unknown
}

export interface PreviewCellRegistryEntry {
	cellId: string
	language: string
	source?: string
	lastRunMs?: number
	lastStatus?: "idle" | "running" | "ok" | "error"
	lastError?: string
}

export type PreviewEventSubscriber = (event: PreviewEvent) => void
export type PreviewStateSubscriber = (snapshot: PreviewSessionSnapshot) => void

export interface PreviewSessionSnapshot {
	moduleId: string
	manifest?: PreviewManifest
	cells: PreviewCellRegistryEntry[]
	recentErrors: PreviewEvent[]
	updatedAtMs: number
}

/**
 * Per-module session state. The service maintains a map of these keyed by
 * `moduleId` so multiple modules can be tracked concurrently.
 */
interface ModuleSession {
	moduleId: string
	manifest?: PreviewManifest
	cells: Map<string, PreviewCellRegistryEntry>
	events: PreviewEvent[]
	updatedAtMs: number
}

export class PreviewSessionService {
	private sessions = new Map<string, ModuleSession>()
	private eventSubscribers = new Set<PreviewEventSubscriber>()
	private stateSubscribers = new Set<PreviewStateSubscriber>()
	private nextSeq = 1

	getSnapshot(moduleId: string): PreviewSessionSnapshot | undefined {
		const session = this.sessions.get(moduleId)
		if (!session) {
			return undefined
		}
		return this.buildSnapshot(session)
	}

	getRecentEvents(moduleId: string, limit = 50, kindFilter?: string): PreviewEvent[] {
		const session = this.sessions.get(moduleId)
		if (!session) {
			return []
		}
		const n = Math.max(1, Math.min(limit, MAX_EVENTS))
		const filtered = kindFilter ? session.events.filter((e) => e.kind === kindFilter) : session.events
		return filtered.slice(-n)
	}

	getAllModuleIds(): string[] {
		return Array.from(this.sessions.keys())
	}

	/**
	 * Ingest a raw event from the webview relay. Updates per-cell registry +
	 * manifest as side effects when the kind warrants it.
	 */
	appendEvent(input: {
		moduleId: string
		cellId?: string
		kind: string
		payloadJson: string
		timestampMs?: number
		source?: string
	}): PreviewEvent {
		const session = this.ensureSession(input.moduleId)
		const event: PreviewEvent = {
			eventId: `evt-${this.nextSeq}-${Date.now().toString(36)}`,
			moduleId: input.moduleId,
			cellId: input.cellId,
			kind: input.kind,
			payloadJson: input.payloadJson,
			timestampMs: input.timestampMs ?? Date.now(),
			eventSeq: this.nextSeq++,
			source: input.source ?? "user",
		}

		session.events.push(event)
		if (session.events.length > MAX_EVENTS) {
			session.events = session.events.slice(-MAX_EVENTS)
		}
		session.updatedAtMs = event.timestampMs

		this.applyEventSideEffects(session, event)

		for (const sub of this.eventSubscribers) {
			try {
				sub(event)
			} catch (err) {
				console.error("[PreviewSessionService] event subscriber error:", err)
			}
		}
		this.notifyState(session)

		// Mirror to disk for MCP server consumption (Phase 1 file-bridge).
		void this.mirrorEventToDisk(event)
		void this.mirrorSnapshotToDisk(session)
		return event
	}

	/**
	 * Direct manifest setter (called by the host when a module is loaded into
	 * the preview, separate from the iframe-driven manifest.loaded event).
	 */
	setManifest(manifest: PreviewManifest): void {
		const session = this.ensureSession(manifest.moduleId)
		session.manifest = manifest
		session.updatedAtMs = Date.now()
		this.notifyState(session)
	}

	subscribeToEvents(cb: PreviewEventSubscriber): () => void {
		this.eventSubscribers.add(cb)
		return () => this.eventSubscribers.delete(cb)
	}

	subscribeToState(cb: PreviewStateSubscriber): () => void {
		this.stateSubscribers.add(cb)
		return () => this.stateSubscribers.delete(cb)
	}

	clearModule(moduleId: string): void {
		this.sessions.delete(moduleId)
	}

	private ensureSession(moduleId: string): ModuleSession {
		let session = this.sessions.get(moduleId)
		if (!session) {
			session = {
				moduleId,
				cells: new Map(),
				events: [],
				updatedAtMs: Date.now(),
			}
			this.sessions.set(moduleId, session)
		}
		return session
	}

	private applyEventSideEffects(session: ModuleSession, event: PreviewEvent): void {
		const payload = this.parsePayload(event.payloadJson)
		switch (event.kind) {
			case "manifest.loaded": {
				const manifest = payload as PreviewManifest
				if (manifest?.moduleId) {
					session.manifest = manifest
				}
				break
			}
			case "cell.registry": {
				const cells = (payload as { cells?: PreviewCellRegistryEntry[] }).cells
				if (Array.isArray(cells)) {
					for (const cell of cells) {
						if (cell.cellId) {
							const existing = session.cells.get(cell.cellId)
							session.cells.set(cell.cellId, { ...existing, ...cell })
						}
					}
				}
				break
			}
			case "cell.run.started": {
				if (event.cellId) {
					const cell = session.cells.get(event.cellId) ?? { cellId: event.cellId, language: "python" }
					session.cells.set(event.cellId, { ...cell, lastStatus: "running", lastRunMs: event.timestampMs })
				}
				break
			}
			case "cell.run.completed": {
				if (event.cellId) {
					const cell = session.cells.get(event.cellId) ?? { cellId: event.cellId, language: "python" }
					session.cells.set(event.cellId, { ...cell, lastStatus: "ok" })
				}
				break
			}
			case "cell.error": {
				if (event.cellId) {
					const cell = session.cells.get(event.cellId) ?? { cellId: event.cellId, language: "python" }
					session.cells.set(event.cellId, {
						...cell,
						lastStatus: "error",
						lastError: typeof payload.message === "string" ? payload.message : undefined,
					})
				}
				break
			}
			// ── UI Refinement: persist comment events into the commentStore ─────
			case "user.comment.draft":
			case "user.comment": {
				const body = typeof payload.body === "string" ? payload.body : ""
				const anchor = (payload.anchor as TextAnchor | undefined) ?? {
					quote: "",
					context: "",
					startOffset: 0,
					endOffset: 0,
				}
				if (body) {
					void commentStoreAdd(session.moduleId, body, anchor).catch((err) =>
						console.warn("[PreviewSessionService] commentStore.addComment failed:", err),
					)
				}
				break
			}
			case "user.batch_changes": {
				const changes = Array.isArray(payload.changes) ? (payload.changes as Array<Record<string, unknown>>) : []
				for (const c of changes) {
					if (typeof c.body !== "string") continue
					const anchor =
						(c.anchor as TextAnchor | undefined) ??
						(c.component
							? {
									quote: `[${(c.component as { kind?: string }).kind ?? "Component"}: ${(c.component as { id?: string }).id ?? ""}]`,
									context: "",
									startOffset: 0,
									endOffset: 0,
									parentSelector: (c.component as { selector?: string }).selector,
								}
							: { quote: "", context: "", startOffset: 0, endOffset: 0 })
					void commentStoreAdd(session.moduleId, c.body, anchor).catch((err) =>
						console.warn("[PreviewSessionService] commentStore.addComment failed:", err),
					)
				}
				break
			}
			case "command.address_comment": {
				const commentId = typeof payload.commentId === "string" ? payload.commentId : null
				const proposed = typeof payload.newText === "string" ? payload.newText : undefined
				if (commentId) {
					void commentStoreUpdate(session.moduleId, commentId, {
						status: "awaiting_review",
						proposedReplacement: proposed,
					}).catch((err) => console.warn("[PreviewSessionService] commentStore.updateComment failed:", err))
				}
				break
			}
			default:
				break
		}
	}

	private buildSnapshot(session: ModuleSession): PreviewSessionSnapshot {
		const recentErrors = session.events.filter((e) => e.kind === "cell.error").slice(-10)
		return {
			moduleId: session.moduleId,
			manifest: session.manifest,
			cells: Array.from(session.cells.values()),
			recentErrors,
			updatedAtMs: session.updatedAtMs,
		}
	}

	private notifyState(session: ModuleSession): void {
		const snapshot = this.buildSnapshot(session)
		for (const sub of this.stateSubscribers) {
			try {
				sub(snapshot)
			} catch (err) {
				console.error("[PreviewSessionService] state subscriber error:", err)
			}
		}
	}

	private parsePayload(json: string | undefined): Record<string, unknown> {
		if (!json?.trim()) {
			return {}
		}
		try {
			return JSON.parse(json) as Record<string, unknown>
		} catch {
			return {}
		}
	}

	private async mirrorSnapshotToDisk(session: ModuleSession): Promise<void> {
		try {
			await fs.mkdir(PREVIEW_SESSION_DIR, { recursive: true })
			const safeId = session.moduleId.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown"
			const file = path.join(PREVIEW_SESSION_DIR, `${safeId}.json`)
			const snapshot = this.buildSnapshot(session)
			await fs.writeFile(file, JSON.stringify(snapshot, null, 2), "utf8")
		} catch (err) {
			// Non-fatal — disk full or permissions; keep the in-memory state
			console.warn("[PreviewSessionService] snapshot mirror failed:", err)
		}
	}

	private async mirrorEventToDisk(event: PreviewEvent): Promise<void> {
		try {
			const safeId = event.moduleId.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown"
			const dir = path.join(PREVIEW_EVENTS_DIR, safeId)
			await fs.mkdir(dir, { recursive: true })
			const file = path.join(dir, `${String(event.eventSeq).padStart(8, "0")}.json`)
			await fs.writeFile(file, JSON.stringify(event), "utf8")

			// Best-effort ring-buffer pruning so the disk doesn't grow unbounded.
			try {
				const entries = await fs.readdir(dir)
				const sorted = entries.filter((e) => e.endsWith(".json")).sort()
				if (sorted.length > MAX_DISK_EVENTS_PER_MODULE) {
					const excess = sorted.slice(0, sorted.length - MAX_DISK_EVENTS_PER_MODULE)
					await Promise.all(excess.map((name) => fs.unlink(path.join(dir, name)).catch(() => undefined)))
				}
			} catch {
				/* pruning is best-effort */
			}
		} catch (err) {
			console.warn("[PreviewSessionService] event mirror failed:", err)
		}
	}
}
