import { type LayerBounds, type LegendSpec, mapLayerToLiveLayer, parseBoundsJson } from "@shared/map/liveLayer"
import type { MapLayer } from "@shared/proto/cline/map"

export type { LayerBounds, LegendSpec }
export { mapLayerToLiveLayer, parseBoundsJson }

export interface CursorRasterReading {
	layerId: string
	layerName: string
	value: number
	min: number
	max: number
	colormap: string
	units?: string
}

const GEOJSON_LAYER_TYPES = new Set(["vector", "point", "line", "polygon", "geojson"])

/** True when the layer has inspectable vector geometry (geemap-style inspector). */
export function isGeoJsonLayer(layer: MapLayer): boolean {
	return GEOJSON_LAYER_TYPES.has(layer.layerType) && Boolean(layer.geojson?.trim())
}

export function isRasterLikeLayer(layer: MapLayer): boolean {
	return layer.layerType === "raster" || layer.layerType === "gee_tile"
}

/** Sample topmost visible raster/gee_tile at lon/lat (render order: last in layerOrder wins). */
interface RasterCacheReader {
	get(id: string):
		| {
				bounds?: LayerBounds
				rawPixels?: { data: Float32Array | number[]; width: number; height: number; min: number; max: number }
		  }
		| undefined
}

export function sampleTopRasterAtPoint(
	layers: MapLayer[],
	visibleLayerIds: Set<string>,
	layerOrder: string[],
	lon: number,
	lat: number,
	rasterCache?: RasterCacheReader,
): CursorRasterReading | null {
	const byId = new Map(layers.map((l) => [l.id, l]))
	const ordered: MapLayer[] = []
	for (const id of layerOrder) {
		const layer = byId.get(id)
		if (layer && visibleLayerIds.has(id) && isRasterLikeLayer(layer)) {
			ordered.push(layer)
		}
	}
	for (const layer of layers) {
		if (visibleLayerIds.has(layer.id) && isRasterLikeLayer(layer) && !ordered.some((o) => o.id === layer.id)) {
			ordered.push(layer)
		}
	}
	for (let i = ordered.length - 1; i >= 0; i--) {
		const reading = sampleRasterAtPoint(ordered[i], lon, lat, rasterCache)
		if (reading) {
			return reading
		}
	}
	return null
}

function sampleRasterAtPoint(
	layer: MapLayer,
	lon: number,
	lat: number,
	rasterCache?: RasterCacheReader,
): CursorRasterReading | null {
	if (layer.layerType === "gee_tile") {
		return null
	}
	const cached = rasterCache?.get(layer.id)
	if (!cached?.rawPixels) {
		return null
	}
	const { data, width, height, min, max } = cached.rawPixels
	const bounds = cached.bounds ?? parseBoundsJson(layer.metadata?.raster_bounds)
	if (!bounds) {
		return null
	}
	const [minLon, minLat, maxLon, maxLat] = bounds
	if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
		return null
	}
	const px = Math.floor(((lon - minLon) / (maxLon - minLon)) * width)
	const py = Math.floor(((maxLat - lat) / (maxLat - minLat)) * height)
	if (px < 0 || px >= width || py < 0 || py >= height) {
		return null
	}
	const value = data[py * width + px]
	if (!Number.isFinite(value)) {
		return null
	}
	return {
		layerId: layer.id,
		layerName: layer.name,
		value,
		min,
		max,
		colormap: layer.metadata?.raster_colormap ?? "viridis",
		units: layer.metadata?.units,
	}
}

/** Resolve WGS84 bounds for zoom / fit (raster, gee_tile, geojson). */
export function getLayerBounds(
	layer: MapLayer,
	rasterCache?: { get(id: string): { bounds?: LayerBounds } | undefined },
): LayerBounds | undefined {
	if (layer.layerType === "gee_tile") {
		return parseBoundsJson(layer.metadata?.gee_bounds)
	}
	if (layer.layerType === "raster") {
		const cached = rasterCache?.get(layer.id)
		if (cached?.bounds) {
			return cached.bounds
		}
		return parseBoundsJson(layer.metadata?.raster_bounds)
	}
	if (!layer.geojson) {
		return undefined
	}
	try {
		const parsed = JSON.parse(layer.geojson) as {
			type?: string
			features?: Array<{ geometry?: { coordinates?: unknown } }>
			geometry?: { coordinates?: unknown }
			geometries?: Array<{ coordinates?: unknown }>
			coordinates?: unknown
		}
		const coords: [number, number][] = []
		const collect = (value: unknown): void => {
			if (Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
				coords.push([value[0], value[1]])
				return
			}
			if (Array.isArray(value)) {
				value.forEach(collect)
			}
		}
		if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
			for (const feature of parsed.features) {
				collect(feature.geometry?.coordinates)
			}
		} else if (parsed.type === "Feature") {
			collect(parsed.geometry?.coordinates)
		} else if (parsed.type === "GeometryCollection" && Array.isArray(parsed.geometries)) {
			for (const geometry of parsed.geometries) {
				collect(geometry.coordinates)
			}
		} else {
			collect(parsed.coordinates)
		}
		if (coords.length === 0) {
			return undefined
		}
		let west = coords[0][0]
		let east = coords[0][0]
		let south = coords[0][1]
		let north = coords[0][1]
		for (const [lon, lat] of coords) {
			west = Math.min(west, lon)
			east = Math.max(east, lon)
			south = Math.min(south, lat)
			north = Math.max(north, lat)
		}
		return [west, south, east, north]
	} catch {
		return undefined
	}
}

export function parseLayerLegend(layer: MapLayer): LegendSpec | undefined {
	const live = mapLayerToLiveLayer(layer)
	if (live.legend?.type === "continuous" || live.legend?.type === "categorical") {
		return live.legend
	}
	if (layer.layerType === "raster" && layer.metadata?.raster_colormap) {
		const min = layer.metadata.min ? parseFloat(layer.metadata.min) : undefined
		const max = layer.metadata.max ? parseFloat(layer.metadata.max) : undefined
		return {
			type: "continuous",
			title: layer.name,
			units: layer.metadata.units,
			min: Number.isFinite(min) ? min : undefined,
			max: Number.isFinite(max) ? max : undefined,
			colormap: layer.metadata.raster_colormap,
		}
	}
	if (layer.layerType === "gee_tile") {
		return {
			type: "continuous",
			title: layer.metadata?.gee_dataset_id || layer.name,
			colormap: "chirps",
		}
	}
	return undefined
}

/** Compact lines for layer panel metadata row. */
export function geeDisplayLines(layer: MapLayer): Array<[string, string]> {
	const meta = layer.metadata ?? {}
	const out: Array<[string, string]> = []
	if (meta.gee_dataset_id) {
		out.push(["dataset", meta.gee_dataset_id])
	}
	if (meta.gee_start_date || meta.gee_end_date) {
		out.push(["dates", `${meta.gee_start_date ?? "?"} → ${meta.gee_end_date ?? "?"}`])
	}
	if (meta.gee_mock === "true") {
		out.push(["mode", "mock tiles"])
	}
	return out
}

export const LEGEND_GRADIENTS: Record<string, string> = {
	viridis: "linear-gradient(to right, #440154, #31688e, #35b779, #fde725)",
	viridis_r: "linear-gradient(to right, #fde725, #35b779, #31688e, #440154)",
	YlOrRd: "linear-gradient(to right, #ffffb2, #fecc5c, #fd8d3c, #e31a1c)",
	Blues: "linear-gradient(to right, #f7fbff, #6baed6, #2171b5, #084594)",
	RdYlGn: "linear-gradient(to right, #d73027, #fee08b, #1a9850)",
	plasma: "linear-gradient(to right, #0d0887, #cc4778, #f0f921)",
	magma: "linear-gradient(to right, #000004, #b73779, #fcfdbf)",
	cividis: "linear-gradient(to right, #00224e, #7c7b78, #fde737)",
	chirps: "linear-gradient(to right, #081d58, #225ea8, #41b6c4, #a1dab4, #ffffcc)",
}

export function gradientForLegend(spec: LegendSpec): string {
	if (spec.type === "categorical") {
		const colors = spec.classes.map((c) => c.color).slice(0, 6)
		if (colors.length === 0) {
			return LEGEND_GRADIENTS.viridis
		}
		const step = 100 / colors.length
		const stops = colors.map((c, i) => `${c} ${i * step}%`).join(", ")
		return `linear-gradient(to right, ${stops})`
	}
	const cmap = spec.colormap ?? "viridis"
	return LEGEND_GRADIENTS[cmap] ?? LEGEND_GRADIENTS.viridis
}
