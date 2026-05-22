import type { MapLayer } from "@shared/proto/cline/map"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

export const MAP_LAYER_CATALOG_FILE = path.join(os.homedir(), ".aihydro", "map_layer_catalog.json")
const MAP_LAYER_GEOJSON_CACHE_DIR = path.join(os.homedir(), ".aihydro", "map_layer_geojson_cache")
const MAX_GEOJSON_CACHE_BYTES = 512_000

export interface NumericAttributeSummary {
	name: string
	min: number
	max: number
	mean: number
}

export interface GraduatedSummary {
	attr: string
	method: string
	classes: number
	ramp: string
}

export interface MapLayerCatalogEntry {
	id: string
	name: string
	layer_type: string
	visible: boolean
	source: string
	workspace_path: string
	/** Absolute path to cached geojson when layer has no workspace file (tool-pushed). */
	geojson_cache_path: string
	style: Record<string, number | string>
	symbology_mode: "basic" | "graduated" | "raster" | "none"
	graduated?: GraduatedSummary
	numeric_attributes: NumericAttributeSummary[]
	feature_count: number
}

export interface MapLayerCatalog {
	updated_at_ms: number
	layer_order: string[]
	layers: MapLayerCatalogEntry[]
}

export function extractNumericAttributes(geojson: string): NumericAttributeSummary[] {
	if (!geojson?.trim()) {
		return []
	}
	try {
		const parsed = JSON.parse(geojson) as {
			type?: string
			features?: Array<{ properties?: Record<string, unknown> }>
			properties?: Record<string, unknown>
		}
		const features =
			parsed.type === "FeatureCollection" && Array.isArray(parsed.features)
				? parsed.features
				: parsed.type === "Feature"
					? [{ properties: parsed.properties }]
					: []
		const attrs = new Map<string, number[]>()
		for (const f of features) {
			const props = f.properties || {}
			for (const [key, val] of Object.entries(props)) {
				if (typeof val === "number" && !key.startsWith("_")) {
					const list = attrs.get(key) ?? []
					list.push(val)
					attrs.set(key, list)
				}
			}
		}
		const result: NumericAttributeSummary[] = []
		for (const [name, values] of attrs) {
			const sorted = [...values].sort((a, b) => a - b)
			const sum = values.reduce((a, b) => a + b, 0)
			result.push({
				name,
				min: sorted[0],
				max: sorted[sorted.length - 1],
				mean: sum / values.length,
			})
		}
		return result.sort((a, b) => a.name.localeCompare(b.name))
	} catch {
		return []
	}
}

function countFeatures(geojson: string): number {
	if (!geojson?.trim()) {
		return 0
	}
	try {
		const parsed = JSON.parse(geojson) as { type?: string; features?: unknown[] }
		if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
			return parsed.features.length
		}
		if (parsed.type === "Feature") {
			return 1
		}
		return 1
	} catch {
		return 0
	}
}

function resolveLayerSource(layer: MapLayer): string {
	const meta = layer.metadata ?? {}
	if (meta.source) {
		return meta.source
	}
	if (meta.path) {
		return "workspace"
	}
	if (meta._run_id || meta.tool) {
		return "tool"
	}
	return "map"
}

function resolveSymbologyMode(layer: MapLayer): MapLayerCatalogEntry["symbology_mode"] {
	const meta = layer.metadata ?? {}
	if (layer.layerType === "raster" || layer.layerType === "gee_tile") {
		return "raster"
	}
	if (meta.graduated_attr && meta.graduated_breaks) {
		return "graduated"
	}
	if (layer.style?.fillColor || layer.style?.strokeColor || layer.style?.color) {
		return "basic"
	}
	return "none"
}

function buildGraduatedSummary(layer: MapLayer): GraduatedSummary | undefined {
	const meta = layer.metadata ?? {}
	if (!meta.graduated_attr) {
		return undefined
	}
	let classes = 0
	try {
		const breaks = JSON.parse(meta.graduated_breaks || "[]") as number[]
		classes = breaks.length
	} catch {
		classes = 0
	}
	return {
		attr: meta.graduated_attr,
		method: meta.graduated_method || "equal",
		classes,
		ramp: meta.graduated_ramp || "viridis",
	}
}

function styleToRecord(layer: MapLayer): Record<string, number | string> {
	const s = layer.style
	if (!s) {
		return {}
	}
	const out: Record<string, number | string> = {}
	if (s.fillColor) out.fillColor = s.fillColor
	if (s.fillOpacity !== undefined) out.fillOpacity = s.fillOpacity
	if (s.strokeColor) out.strokeColor = s.strokeColor
	if (s.color) out.color = s.color
	if (s.strokeWidth !== undefined) out.strokeWidth = s.strokeWidth
	if (s.weight !== undefined) out.weight = s.weight
	if (s.opacity !== undefined) out.opacity = s.opacity
	if (layer.layerType === "raster") {
		if (layer.metadata?.raster_colormap) out.raster_colormap = layer.metadata.raster_colormap
		if (layer.metadata?.raster_opacity) out.raster_opacity = layer.metadata.raster_opacity
	}
	return out
}

export function layerToCatalogEntry(layer: MapLayer, geojsonCachePath = ""): MapLayerCatalogEntry {
	const meta = layer.metadata ?? {}
	const workspacePath = meta.path || meta.workspace_path || ""
	return {
		id: layer.id,
		name: meta.display_name || layer.name || layer.id,
		layer_type: layer.layerType || "polygon",
		visible: layer.visible !== false,
		source: resolveLayerSource(layer),
		workspace_path: workspacePath,
		geojson_cache_path: geojsonCachePath,
		style: styleToRecord(layer),
		symbology_mode: resolveSymbologyMode(layer),
		graduated: buildGraduatedSummary(layer),
		numeric_attributes: extractNumericAttributes(layer.geojson || ""),
		feature_count: countFeatures(layer.geojson || ""),
	}
}

async function cacheLayerGeojsonIfNeeded(layer: MapLayer): Promise<string> {
	const meta = layer.metadata ?? {}
	if (meta.path || meta.workspace_path) {
		return ""
	}
	const geojson = layer.geojson?.trim()
	if (!geojson || Buffer.byteLength(geojson, "utf8") > MAX_GEOJSON_CACHE_BYTES) {
		return ""
	}
	try {
		await fs.mkdir(MAP_LAYER_GEOJSON_CACHE_DIR, { recursive: true })
		const safeId = layer.id.replace(/[^a-zA-Z0-9_-]/g, "_")
		const cachePath = path.join(MAP_LAYER_GEOJSON_CACHE_DIR, `${safeId}.geojson`)
		await fs.writeFile(cachePath, geojson, "utf8")
		return cachePath
	} catch {
		return ""
	}
}

export async function buildMapLayerCatalogAsync(layers: MapLayer[], layerOrder: string[]): Promise<MapLayerCatalog> {
	const order = layerOrder.length > 0 ? layerOrder.filter((id) => layers.some((l) => l.id === id)) : layers.map((l) => l.id)
	for (const layer of layers) {
		if (!order.includes(layer.id)) {
			order.push(layer.id)
		}
	}
	const entries: MapLayerCatalogEntry[] = []
	for (const id of order) {
		const layer = layers.find((l) => l.id === id)
		if (!layer) {
			continue
		}
		const cachePath = await cacheLayerGeojsonIfNeeded(layer)
		entries.push(layerToCatalogEntry(layer, cachePath))
	}
	return {
		updated_at_ms: Date.now(),
		layer_order: order,
		layers: entries,
	}
}

/** Sync build without geojson cache writes (used in task context). */
export function buildMapLayerCatalog(layers: MapLayer[], layerOrder: string[]): MapLayerCatalog {
	const order = layerOrder.length > 0 ? layerOrder.filter((id) => layers.some((l) => l.id === id)) : layers.map((l) => l.id)
	for (const layer of layers) {
		if (!order.includes(layer.id)) {
			order.push(layer.id)
		}
	}
	return {
		updated_at_ms: Date.now(),
		layer_order: order,
		layers: order
			.map((id) => layers.find((l) => l.id === id))
			.filter((l): l is MapLayer => l !== undefined)
			.map((layer) => layerToCatalogEntry(layer)),
	}
}

export async function persistMapLayerCatalog(catalog: MapLayerCatalog): Promise<void> {
	try {
		await fs.mkdir(path.dirname(MAP_LAYER_CATALOG_FILE), { recursive: true })
		await fs.writeFile(MAP_LAYER_CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8")
	} catch (err) {
		console.warn("[mapLayerCatalog] persist failed:", err)
	}
}

export async function readMapLayerCatalog(): Promise<MapLayerCatalog | null> {
	try {
		const raw = await fs.readFile(MAP_LAYER_CATALOG_FILE, "utf8")
		return JSON.parse(raw) as MapLayerCatalog
	} catch {
		return null
	}
}
