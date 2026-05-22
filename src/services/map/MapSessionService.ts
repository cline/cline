import type { MapEvent, MapLayer, MapRoi, MapSessionState, MapSessionView } from "@shared/proto/cline/map"
import { MapRoi as MapRoiProto, MapSessionState as MapSessionStateProto } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const MAP_SESSION_FILE = path.join(os.homedir(), ".aihydro", "map_session.json")
const OUTBOUND_EVENTS_DIR = path.join(os.homedir(), ".aihydro", "map_events", "outbound")
const MAX_EVENTS = 100

export type MapSessionSubscriber = (state: MapSessionState) => void
export type MapEventSubscriber = (event: MapEvent) => void

export interface LastMapInspect {
	lat: number
	lon: number
	layerName?: string
	featureProperties?: Record<string, unknown>
	visibleLayerNames?: string[]
	featureCount?: number
}

function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_|_$/g, "")
			.slice(0, 64) || "roi"
	)
}

/**
 * Host-owned map session: ROI, view, event ring buffer, workspace persistence.
 */
export class MapSessionService {
	private activeRoi: MapRoi | undefined
	private view: MapSessionView | undefined
	private visibleLayerIds: string[] = []
	private basemapId = ""
	private basemapName = ""
	private workspaceRoot: string = ""
	private updatedAtMs = Date.now()
	private events: MapEvent[] = []
	private lastInspect: LastMapInspect | undefined
	private sessionSubscribers = new Set<MapSessionSubscriber>()
	private eventSubscribers = new Set<MapEventSubscriber>()

	constructor(workspaceRoot?: string) {
		if (workspaceRoot) {
			this.workspaceRoot = workspaceRoot
		}
	}

	async initialize(): Promise<void> {
		await this.loadFromDisk()
	}

	setWorkspaceRoot(root: string): void {
		if (root && root !== this.workspaceRoot) {
			this.workspaceRoot = root
			this.touch()
		}
	}

	getActiveRoi(): MapRoi | undefined {
		return this.activeRoi
	}

	setActiveRoi(roi: MapRoi | undefined, source: string = "user"): void {
		if (!roi?.geojson?.trim()) {
			this.clearActiveRoi(source)
			return
		}
		this.activeRoi = roi
		this.touch()
		this.notifySession()
		void this.persist()
		this.appendEvent({
			type: "roi.set",
			payloadJson: JSON.stringify({ name: roi.name, source: roi.source, areaHa: roi.areaHa }),
			timestampMs: Date.now(),
			source,
		})
	}

	clearActiveRoi(source: string = "user"): void {
		if (!this.activeRoi) {
			return
		}
		this.activeRoi = undefined
		this.touch()
		this.notifySession()
		void this.persist()
		this.appendEvent({
			type: "roi.cleared",
			payloadJson: "{}",
			timestampMs: Date.now(),
			source,
		})
	}

	setView(view: MapSessionView): void {
		this.view = view
		this.touch()
		this.notifySession()
		void this.persist()
	}

	setVisibleLayerIds(ids: string[]): void {
		this.visibleLayerIds = ids
		this.touch()
		this.notifySession()
		void this.persist()
	}

	getBasemap(): { id: string; name: string } | undefined {
		if (!this.basemapId) {
			return undefined
		}
		return { id: this.basemapId, name: this.basemapName || this.basemapId }
	}

	getView(): MapSessionView | undefined {
		return this.view
	}

	setBasemap(id: string, name?: string): void {
		if (!id?.trim()) {
			return
		}
		this.basemapId = id.trim()
		this.basemapName = name?.trim() || id
		this.touch()
		this.notifySession()
		void this.persist()
	}

	appendEvent(event: MapEvent): void {
		this.events.push(event)
		if (this.events.length > MAX_EVENTS) {
			this.events = this.events.slice(-MAX_EVENTS)
		}
		for (const sub of this.eventSubscribers) {
			try {
				sub(event)
			} catch (err) {
				console.error("[MapSessionService] event subscriber error:", err)
			}
		}
		void this.mirrorEventToDisk(event)
	}

	getRecentEvents(limit = 20): MapEvent[] {
		const n = Math.max(1, Math.min(limit, MAX_EVENTS))
		return this.events.slice(-n)
	}

	setLastInspect(inspect: LastMapInspect): void {
		this.lastInspect = inspect
		this.touch()
	}

	getLastInspect(): LastMapInspect | undefined {
		return this.lastInspect
	}

	buildSnapshot(layers: MapLayer[]): MapSessionState {
		return MapSessionStateProto.create({
			layers,
			activeRoi: this.activeRoi,
			view: this.view,
			visibleLayerIds: this.visibleLayerIds,
			workspaceRoot: this.workspaceRoot,
			updatedAtMs: this.updatedAtMs,
			basemapId: this.basemapId,
			basemapName: this.basemapName,
		})
	}

	subscribeToSession(cb: MapSessionSubscriber): () => void {
		this.sessionSubscribers.add(cb)
		return () => this.sessionSubscribers.delete(cb)
	}

	subscribeToEvents(cb: MapEventSubscriber): () => void {
		this.eventSubscribers.add(cb)
		return () => this.eventSubscribers.delete(cb)
	}

	/** Save drawn or imported geometry as a workspace vector file (no global ROI pointer). */
	async saveGeometryToWorkspace(name: string, geojson: string): Promise<{ workspacePath: string }> {
		const root = this.workspaceRoot
		if (!root) {
			throw new Error("Workspace root not set — open a folder workspace first")
		}
		if (!geojson?.trim()) {
			throw new Error("No geometry to save")
		}
		const slug = slugify(name || "drawn")
		const vectorsDir = path.join(root, "vectors")
		await fs.mkdir(vectorsDir, { recursive: true })
		const relGeo = `vectors/${slug}.geojson`
		await fs.writeFile(path.join(root, relGeo), geojson, "utf8")
		this.appendEvent({
			type: "user.file_saved",
			payloadJson: JSON.stringify({ path: relGeo, name: slug }),
			timestampMs: Date.now(),
			source: "user",
		})
		return { workspacePath: relGeo }
	}

	async saveRoiToWorkspace(name: string, roi?: MapRoi): Promise<{ workspacePath: string; activePointerPath: string }> {
		const target = roi ?? this.activeRoi
		if (!target?.geojson?.trim()) {
			throw new Error("No active ROI geometry to save")
		}
		const root = this.workspaceRoot
		if (!root) {
			throw new Error("Workspace root not set — open a folder workspace first")
		}
		const slug = slugify(name || target.name || "basin")
		const roiDir = path.join(root, "roi")
		await fs.mkdir(roiDir, { recursive: true })
		const geoPath = path.join(roiDir, `${slug}.geojson`)
		await fs.writeFile(geoPath, target.geojson, "utf8")
		const relGeo = `roi/${slug}.geojson`
		const pointer = {
			path: relGeo,
			name: target.name || slug,
			updatedAt: new Date().toISOString(),
		}
		const relPointer = "roi/active.json"
		await fs.writeFile(path.join(root, relPointer), JSON.stringify(pointer, null, 2), "utf8")
		this.activeRoi = {
			...target,
			workspacePath: relGeo,
			source: target.source || "workspace",
		}
		this.touch()
		this.notifySession()
		await this.persist()
		this.appendEvent({
			type: "roi.saved",
			payloadJson: JSON.stringify({ path: relGeo, name: pointer.name }),
			timestampMs: Date.now(),
			source: "user",
		})
		return { workspacePath: relGeo, activePointerPath: relPointer }
	}

	async loadRoiFromWorkspace(workspacePath?: string): Promise<MapRoi> {
		const root = this.workspaceRoot
		if (!root) {
			throw new Error("Workspace root not set")
		}
		let relPath = workspacePath?.trim()
		if (!relPath) {
			const pointerPath = path.join(root, "roi", "active.json")
			const raw = await fs.readFile(pointerPath, "utf8")
			const pointer = JSON.parse(raw) as { path?: string; name?: string }
			relPath = pointer.path
			if (!relPath) {
				throw new Error("roi/active.json has no path")
			}
		}
		const abs = path.isAbsolute(relPath) ? relPath : path.join(root, relPath)
		const geojson = await fs.readFile(abs, "utf8")
		const loaded = MapRoiProto.create({
			id: slugify(path.basename(relPath, ".geojson")),
			name: path.basename(relPath, ".geojson"),
			source: "workspace",
			geojson,
			areaHa: 0,
			workspacePath: relPath,
		})
		this.setActiveRoi(loaded, "user")
		return loaded
	}

	/** Read map session ROI from disk file (for Python bridge). */
	static async readPersistedSession(): Promise<{ activeRoi?: MapRoi } | null> {
		try {
			const raw = await fs.readFile(MAP_SESSION_FILE, "utf8")
			return JSON.parse(raw) as { activeRoi?: MapRoi }
		} catch {
			return null
		}
	}

	private touch(): void {
		this.updatedAtMs = Date.now()
	}

	private notifySession(): void {
		for (const sub of this.sessionSubscribers) {
			try {
				sub(this.buildSnapshot([]))
			} catch (err) {
				console.error("[MapSessionService] session subscriber error:", err)
			}
		}
	}

	private async persist(): Promise<void> {
		try {
			await fs.mkdir(path.dirname(MAP_SESSION_FILE), { recursive: true })
			const payload = {
				activeRoi: this.activeRoi,
				view: this.view,
				visibleLayerIds: this.visibleLayerIds,
				basemapId: this.basemapId,
				basemapName: this.basemapName,
				workspaceRoot: this.workspaceRoot,
				updatedAtMs: this.updatedAtMs,
			}
			await fs.writeFile(MAP_SESSION_FILE, JSON.stringify(payload, null, 2), "utf8")
		} catch (err) {
			console.warn("[MapSessionService] persist failed:", err)
		}
	}

	private async loadFromDisk(): Promise<void> {
		try {
			const raw = await fs.readFile(MAP_SESSION_FILE, "utf8")
			const data = JSON.parse(raw) as {
				activeRoi?: MapRoi
				view?: MapSessionView
				visibleLayerIds?: string[]
				basemapId?: string
				basemapName?: string
				workspaceRoot?: string
				updatedAtMs?: number
			}
			this.activeRoi = data.activeRoi
			this.view = data.view
			this.visibleLayerIds = data.visibleLayerIds ?? []
			this.basemapId = data.basemapId ?? ""
			this.basemapName = data.basemapName ?? ""
			if (data.workspaceRoot) {
				this.workspaceRoot = data.workspaceRoot
			}
			this.updatedAtMs = data.updatedAtMs ?? Date.now()
		} catch {
			/* first run */
		}
	}

	private async mirrorEventToDisk(event: MapEvent): Promise<void> {
		try {
			await fs.mkdir(OUTBOUND_EVENTS_DIR, { recursive: true })
			const file = path.join(OUTBOUND_EVENTS_DIR, `${event.timestampMs ?? Date.now()}.json`)
			await fs.writeFile(file, JSON.stringify(event), "utf8")
		} catch {
			/* non-fatal */
		}
	}
}
