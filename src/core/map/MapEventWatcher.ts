/**
 * MapEventWatcher — polls ~/.aihydro/map_events/ for layer event files
 * written by the Python MCP tools and forwards them to the map panel.
 *
 * Flow:
 *   Python push_layer() / push_raster_layer() writes ~/.aihydro/map_events/<uuid>.json
 *     → this watcher reads the file
 *       → calls controller.addMapLayer()  (broadcasts to all subscribers)
 *         → optionally opens the map panel  (openMap: true in event)
 *           → deletes the processed file
 *
 * GeoJSON layers  → stored verbatim in MapLayer.geojson; rendered as GeoJsonLayer
 * Raster layers   → PNG read from disk, base64-encoded, stored in MapLayer.metadata
 *                   as raster_data_url + raster_bounds; rendered as BitmapLayer
 *
 * Each event file is a one-shot message: write, consume, delete.
 * Processing is idempotent — re-reading a file replaces the layer with the same id.
 */

import type { Controller } from "@core/controller"
import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const MAP_EVENTS_DIR = path.join(os.homedir(), ".aihydro", "map_events")
const POLL_INTERVAL_MS = 600

interface RasterPayload {
	path: string
	bounds: [number, number, number, number] // [west, south, east, north]
	opacity?: number
	colormap?: string
}

interface MapEventPayload {
	id: string
	name: string
	geojson: string
	layerType?: string
	raster?: RasterPayload
	style?: {
		fillColor?: string
		fillOpacity?: number
		color?: string
		strokeColor?: string
		strokeWidth?: number
		weight?: number
		opacity?: number
	}
	autoZoom?: boolean
	openMap?: boolean
	metadata?: Record<string, string>
	timestamp?: string
}

export class MapEventWatcher {
	private controller: Controller
	private timer: ReturnType<typeof setInterval> | null = null
	private processing = false

	constructor(controller: Controller) {
		this.controller = controller
	}

	start(): void {
		if (this.timer) {
			return
		}
		this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
		this.poll() // process any queued events immediately
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer)
			this.timer = null
		}
	}

	private async poll(): Promise<void> {
		if (this.processing) {
			return
		}
		this.processing = true
		try {
			await this.processDir()
		} catch {
			// Directory may not exist yet — fine
		} finally {
			this.processing = false
		}
	}

	private async processDir(): Promise<void> {
		let entries: string[]
		try {
			entries = await fs.readdir(MAP_EVENTS_DIR)
		} catch {
			return
		}

		const jsonFiles = entries.filter((f) => f.endsWith(".json"))
		if (jsonFiles.length === 0) {
			return
		}

		for (const file of jsonFiles) {
			const filePath = path.join(MAP_EVENTS_DIR, file)
			await this.processEventFile(filePath)
		}
	}

	private async processEventFile(filePath: string): Promise<void> {
		let raw: string
		try {
			raw = await fs.readFile(filePath, "utf-8")
		} catch {
			return // file deleted by concurrent process
		}

		let event: MapEventPayload
		try {
			event = JSON.parse(raw)
		} catch {
			console.warn("[MapEventWatcher] Malformed event file, removing:", filePath)
			await this.deleteFile(filePath)
			return
		}

		await this.deleteFile(filePath) // delete before apply — prevents reprocessing on error

		try {
			await this.applyEvent(event)
		} catch (err) {
			console.error("[MapEventWatcher] Failed to apply event:", event.id, err)
		}
	}

	private async applyEvent(event: MapEventPayload): Promise<void> {
		const isRaster = event.layerType === "raster" && event.raster != null

		let layer: MapLayer

		if (isRaster) {
			layer = await this.buildRasterLayer(event)
		} else {
			layer = this.buildVectorLayer(event)
		}

		console.log(`[MapEventWatcher] Applying ${isRaster ? "raster" : "vector"} layer: ${event.id}`)
		this.controller.addMapLayer(layer)

		if (event.openMap) {
			try {
				const { VscodeMapPanelProvider } = await import("@/hosts/vscode/VscodeMapPanelProvider")
				await VscodeMapPanelProvider.createOrShow()
			} catch {
				// Not in VS Code environment (tests / desktop) — skip silently
			}
		}
	}

	private buildVectorLayer(event: MapEventPayload): MapLayer {
		const style = event.style ?? {}
		const mapLayerStyle = MapLayerStyle.create({
			fillColor: style.fillColor ?? "#0066CC",
			fillOpacity: style.fillOpacity ?? 0.3,
			color: style.color ?? style.strokeColor ?? "#003399",
			strokeColor: style.strokeColor ?? style.color ?? "#003399",
			strokeWidth: style.strokeWidth ?? style.weight ?? 2,
			weight: style.weight ?? style.strokeWidth ?? 2,
			opacity: style.opacity ?? 1.0,
		})

		return MapLayer.create({
			id: event.id,
			name: event.name,
			geojson: event.geojson ?? "",
			layerType: event.layerType ?? "polygon",
			style: mapLayerStyle,
			visible: true,
			metadata: {
				...(event.metadata ?? {}),
				...(event.timestamp ? { addedAt: event.timestamp } : {}),
			},
		})
	}

	private async buildRasterLayer(event: MapEventPayload): Promise<MapLayer> {
		const raster = event.raster!
		const opacity = raster.opacity ?? 0.75

		// Read the tile PNG and encode as a data URL so the webview can render it
		// without needing file:// URI access (blocked by webview CSP).
		let dataUrl = ""
		try {
			const pngBuffer = await fs.readFile(raster.path)
			dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`
		} catch (err) {
			console.warn(`[MapEventWatcher] Could not read raster PNG at ${raster.path}:`, err)
		}

		return MapLayer.create({
			id: event.id,
			name: event.name,
			geojson: "", // unused for raster layers
			layerType: "raster",
			visible: true,
			metadata: {
				...(event.metadata ?? {}),
				raster_data_url: dataUrl,
				raster_bounds: JSON.stringify(raster.bounds), // "[west,south,east,north]"
				raster_opacity: String(opacity),
				raster_colormap: raster.colormap ?? "viridis",
				raster_path: raster.path,
				...(event.timestamp ? { addedAt: event.timestamp } : {}),
			},
		})
	}

	private async deleteFile(filePath: string): Promise<void> {
		try {
			await fs.unlink(filePath)
		} catch {
			// Already deleted or inaccessible — safe to ignore
		}
	}
}
