/**
 * Shared types for client-side format adapters.
 *
 * Each adapter takes a File (or set of Files) and returns a normalized
 * `LayerSpec` that the map can render directly via gRPC addMapLayer.
 *
 * Vector adapters return GeoJSON.
 * Raster adapters return a base64-encoded PNG data URL + WGS84 bounds.
 */

export interface VectorLayerSpec {
	kind: "vector"
	id: string
	name: string
	geojson: string // stringified GeoJSON FeatureCollection
	style?: {
		fillColor?: string
		fillOpacity?: number
		strokeColor?: string
		strokeWidth?: number
	}
	metadata?: Record<string, string>
	source?: LayerSourceSpec
}

export interface LayerSourceSpec {
	uri?: string
	path?: string
	displayPath?: string
	format?: string
	mtimeMs?: number
	sizeBytes?: number
	remoteUrl?: string
	derivedFrom?: string
}

export interface RasterPixels {
	data: Float32Array
	width: number
	height: number
	min: number
	max: number
}

export interface RasterLayerSpec {
	kind: "raster"
	id: string
	name: string
	dataUrl: string // data:image/png;base64,...
	bounds: [number, number, number, number] // [west, south, east, north] WGS84
	opacity?: number
	colormap?: string
	/** Raw Float32 band values — enables client-side colormap recoloring without re-loading the file. */
	rawPixels?: RasterPixels
	metadata?: Record<string, string>
	source?: LayerSourceSpec
}

export type LayerSpec = VectorLayerSpec | RasterLayerSpec

export type FormatId = "geojson" | "topojson" | "kml" | "kmz" | "gpx" | "shp" | "tiff" | "csv"

export interface FormatInfo {
	id: FormatId
	label: string
	extensions: string[]
	multiFile?: boolean
}

export const SUPPORTED_FORMATS: FormatInfo[] = [
	{ id: "geojson", label: "GeoJSON", extensions: [".geojson", ".json"] },
	{ id: "topojson", label: "TopoJSON", extensions: [".topojson", ".topo.json"] },
	{ id: "kml", label: "KML", extensions: [".kml"] },
	{ id: "kmz", label: "KMZ", extensions: [".kmz"] },
	{ id: "gpx", label: "GPX", extensions: [".gpx"] },
	{ id: "shp", label: "Shapefile (.zip)", extensions: [".zip", ".shp"] },
	{ id: "tiff", label: "GeoTIFF / COG", extensions: [".tif", ".tiff"] },
	{ id: "csv", label: "CSV (lat/lon)", extensions: [".csv"] },
]

export const ACCEPTED_EXTENSIONS = SUPPORTED_FORMATS.flatMap((f) => f.extensions).join(",")

export function detectFormat(filename: string): FormatId | null {
	const lower = filename.toLowerCase()
	for (const fmt of SUPPORTED_FORMATS) {
		if (fmt.extensions.some((ext) => lower.endsWith(ext))) {
			// Disambiguate .json vs .topojson — TopoJSON has a "topology" type field,
			// but we'll inspect that in the adapter, not here. Default .json → geojson.
			return fmt.id
		}
	}
	return null
}

export class LayerLoadError extends Error {
	constructor(
		message: string,
		public readonly format?: FormatId,
		public readonly cause?: unknown,
	) {
		super(message)
		this.name = "LayerLoadError"
	}
}
