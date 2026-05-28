/**
 * Format dispatcher — turns a browser File into a LayerSpec.
 *
 * Each adapter is loaded *lazily* via dynamic import so the deck.gl bundle
 * stays small for users who never load that format.
 */

import { detectFormat, LayerLoadError, type LayerSpec, type RasterPixels } from "./types"

const slugify = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")

const stripExt = (s: string): string => s.replace(/\.[^.]+$/, "")

const MAX_TIFF_RENDER_DIM = 1536
const MAX_TIFF_RENDER_PIXELS = 1_500_000

export interface LoadOptions {
	idPrefix?: string
	idOverride?: string
	nameOverride?: string
}

export async function loadFile(file: File, opts: LoadOptions = {}): Promise<LayerSpec> {
	const fmt = detectFormat(file.name)
	if (!fmt) {
		throw new LayerLoadError(`Unsupported file type: ${file.name}. Try GeoJSON, KML, GPX, Shapefile (.zip), or GeoTIFF.`)
	}

	// Stable ID derived from filename only — re-adding the same file replaces
	// the existing layer (MapContext keys layers by id) instead of duplicating.
	// Two files with the same name from different folders will collide; that's
	// an acceptable edge case for now.
	const baseId = opts.idOverride ?? `${opts.idPrefix ?? "user"}-${slugify(stripExt(file.name))}`
	const baseName = opts.nameOverride ?? stripExt(file.name)

	try {
		switch (fmt) {
			case "geojson":
			case "topojson":
				return await loadJsonish(file, baseId, baseName)
			case "kml":
				return await loadKml(file, baseId, baseName)
			case "kmz":
				return await loadKmz(file, baseId, baseName)
			case "gpx":
				return await loadGpx(file, baseId, baseName)
			case "shp":
				return await loadShp(file, baseId, baseName)
			case "tiff":
				return await loadTiff(file, baseId, baseName)
			case "csv":
				return await loadCsv(file, baseId, baseName)
		}
	} catch (err) {
		if (err instanceof LayerLoadError) {
			throw err
		}
		throw new LayerLoadError(`Failed to read ${file.name}: ${err instanceof Error ? err.message : String(err)}`, fmt, err)
	}
}

async function loadJsonish(file: File, id: string, name: string): Promise<LayerSpec> {
	const text = await file.text()
	let parsed: any
	try {
		parsed = JSON.parse(text)
	} catch {
		throw new LayerLoadError(`${file.name} is not valid JSON.`)
	}
	if (parsed?.type === "Topology") {
		// TopoJSON — convert to GeoJSON
		const { feature } = await import("topojson-client")
		const objects = parsed.objects ?? {}
		const firstKey = Object.keys(objects)[0]
		if (!firstKey) {
			throw new LayerLoadError(`${file.name} has no topology objects.`)
		}
		const fc: any = feature(parsed, objects[firstKey])
		return {
			kind: "vector",
			id,
			name,
			geojson: JSON.stringify(fc),
			metadata: { format: "topojson" },
		}
	}
	if (
		parsed?.type === "FeatureCollection" ||
		parsed?.type === "Feature" ||
		parsed?.type === "GeometryCollection" ||
		parsed?.type === "Point" ||
		parsed?.type === "LineString" ||
		parsed?.type === "Polygon" ||
		parsed?.type === "MultiPoint" ||
		parsed?.type === "MultiLineString" ||
		parsed?.type === "MultiPolygon"
	) {
		return {
			kind: "vector",
			id,
			name,
			geojson: text,
			metadata: { format: "geojson" },
		}
	}
	throw new LayerLoadError(`${file.name} is not a recognized GeoJSON / TopoJSON document.`)
}

async function loadKml(file: File, id: string, name: string): Promise<LayerSpec> {
	const text = await file.text()
	const doc = new DOMParser().parseFromString(text, "text/xml")
	if (doc.querySelector("parsererror")) {
		throw new LayerLoadError(`${file.name} is not valid XML.`)
	}
	const { kml } = await import("@tmcw/togeojson")
	const fc = kml(doc)
	return {
		kind: "vector",
		id,
		name,
		geojson: JSON.stringify(fc),
		metadata: { format: "kml" },
	}
}

async function loadKmz(file: File, id: string, name: string): Promise<LayerSpec> {
	// KMZ is a zip containing a doc.kml — extract it via JSZip (already a transitive dep)
	const JSZip = (await import("jszip")).default
	const buf = await file.arrayBuffer()
	const zip = await JSZip.loadAsync(buf)
	const kmlEntry = Object.values(zip.files).find((f) => /\.kml$/i.test(f.name))
	if (!kmlEntry) {
		throw new LayerLoadError(`${file.name} contains no .kml entry.`)
	}
	const kmlText = await kmlEntry.async("string")
	const doc = new DOMParser().parseFromString(kmlText, "text/xml")
	const { kml } = await import("@tmcw/togeojson")
	const fc = kml(doc)
	return {
		kind: "vector",
		id,
		name,
		geojson: JSON.stringify(fc),
		metadata: { format: "kmz" },
	}
}

async function loadGpx(file: File, id: string, name: string): Promise<LayerSpec> {
	const text = await file.text()
	const doc = new DOMParser().parseFromString(text, "text/xml")
	if (doc.querySelector("parsererror")) {
		throw new LayerLoadError(`${file.name} is not valid XML.`)
	}
	const { gpx } = await import("@tmcw/togeojson")
	const fc = gpx(doc)
	return {
		kind: "vector",
		id,
		name,
		geojson: JSON.stringify(fc),
		metadata: { format: "gpx" },
	}
}

async function loadShp(file: File, id: string, name: string): Promise<LayerSpec> {
	// shpjs accepts a zipped shapefile bundle (.shp + .dbf + .shx + optional .prj)
	const shpMod: any = await import("shpjs")
	const shp = shpMod.default ?? shpMod
	const buf = await file.arrayBuffer()
	let result: any
	try {
		result = await shp(buf)
	} catch (err) {
		throw new LayerLoadError(
			`Failed to parse ${file.name}. For shapefiles, zip the .shp, .dbf, .shx, and .prj together first.`,
			"shp",
			err,
		)
	}
	// shpjs returns either a FeatureCollection or an array of FeatureCollections (for multi-layer zips)
	const fc = Array.isArray(result)
		? { type: "FeatureCollection", features: result.flatMap((r: any) => r.features ?? []) }
		: result
	return {
		kind: "vector",
		id,
		name,
		geojson: JSON.stringify(fc),
		metadata: { format: "shapefile" },
	}
}

/** Returns a proj4 definition string for common EPSG codes used in hydrology. */
function getProj4Def(epsg: number): string | null {
	// WGS84 / NAD83 — treat as geographic, no transform needed
	if (epsg === 4326 || epsg === 4269 || epsg === 4152) return null
	// Web Mercator
	if (epsg === 3857 || epsg === 900913)
		return "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +no_defs"
	// CONUS Albers — used by NLCD, POLARIS, 3DEP, NWM rasters
	if (epsg === 5070)
		return "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs"
	// NAD83 CONUS Albers (older code)
	if (epsg === 102003)
		return "+proj=aea +lat_0=37.5 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs"
	// NAD83 UTM zones 1–60 (EPSG 26901–26960)
	if (epsg >= 26901 && epsg <= 26960) return `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`
	// WGS84 UTM zones North 1–60 (EPSG 32601–32660)
	if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`
	// WGS84 UTM zones South 1–60 (EPSG 32701–32760)
	if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`
	// NAD27 UTM zones (EPSG 26701–26760)
	if (epsg >= 26701 && epsg <= 26760) return `+proj=utm +zone=${epsg - 26700} +datum=NAD27 +units=m +no_defs`
	// GRS80 / ETRS89 UTM zones (EPSG 25800–25860)
	if (epsg >= 25801 && epsg <= 25860) return `+proj=utm +zone=${epsg - 25800} +ellps=GRS80 +units=m +no_defs`
	return null
}

/** Reproject four bbox corners from source proj4 string to WGS84 lon/lat.
 *  Returns [minLon, minLat, maxLon, maxLat]. */
async function reprojectBbox(bbox: number[], srcDef: string): Promise<[number, number, number, number]> {
	const proj4 = (await import("proj4")).default
	const [minX, minY, maxX, maxY] = bbox
	const corners = [
		[minX, minY],
		[maxX, minY],
		[maxX, maxY],
		[minX, maxY],
	].map(([x, y]) => proj4(srcDef, "WGS84", [x, y]))
	const lons = corners.map((c) => c[0])
	const lats = corners.map((c) => c[1])
	return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

async function loadTiff(file: File, id: string, name: string): Promise<LayerSpec> {
	const { fromArrayBuffer } = await import("geotiff")
	const arrayBuffer = await file.arrayBuffer()
	const tiff = await fromArrayBuffer(arrayBuffer)
	const image = await tiff.getImage()
	const srcBbox = image.getBoundingBox() // [minX, minY, maxX, maxY] in source CRS
	const geoKeys = image.getGeoKeys?.() ?? {}
	const epsg: number | null = geoKeys?.ProjectedCSTypeGeoKey ?? geoKeys?.GeographicTypeGeoKey ?? null
	const sourceWidth = image.getWidth()
	const sourceHeight = image.getHeight()
	const sampleSize = fitRasterSize(sourceWidth, sourceHeight)

	// Read a bounded display-resolution sample. Native GeoTIFFs can be many
	// millions of pixels; decoding/rendering them at full size can freeze the
	// VS Code webview and bloat the gRPC layer metadata.
	const rasters = (await image.readRasters({
		interleave: false,
		samples: [0],
		width: sampleSize.width,
		height: sampleSize.height,
		resampleMethod: "bilinear",
	})) as any
	const nodata = parseNoData(image)
	const srcBand = normalizeRasterBand(rasters, nodata)

	// Compute min/max from source data (skip nodata / NaN)
	let min = Infinity
	let max = -Infinity
	for (let i = 0; i < srcBand.length; i++) {
		const v = srcBand[i]
		if (Number.isFinite(v)) {
			if (v < min) min = v
			if (v > max) max = v
		}
	}
	if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
		throw new LayerLoadError(`${file.name} contains no usable pixel data.`)
	}

	// Determine WGS84 bbox and pixel data to render
	let wgs84Bbox: [number, number, number, number]
	let renderBand: Float32Array
	let renderW: number
	let renderH: number
	let reprojected = false
	let proj4Def: string | null = null

	if (epsg && epsg !== 4326 && epsg !== 4269) {
		proj4Def = getProj4Def(epsg)
		if (!proj4Def) {
			throw new LayerLoadError(
				`GeoTIFF is in EPSG:${epsg}. Reproject to EPSG:4326 (WGS84) first — this CRS isn't in the built-in reprojection table yet.`,
				"tiff",
			)
		}
		try {
			wgs84Bbox = await reprojectBbox(srcBbox, proj4Def)
			reprojected = true
		} catch {
			throw new LayerLoadError(
				`GeoTIFF is in EPSG:${epsg} and reprojection failed. Please reproject to EPSG:4326 (WGS84) manually.`,
				"tiff",
			)
		}
		// Warp pixel grid: for each WGS84 output pixel, inverse-project to source CRS
		// and bilinear-interpolate. This aligns the raster with vector layers in WGS84.
		const warped = await warpPixelsToWgs84(srcBand, sampleSize.width, sampleSize.height, srcBbox, wgs84Bbox, proj4Def)
		renderBand = warped.data
		renderW = warped.width
		renderH = warped.height
	} else {
		wgs84Bbox = [srcBbox[0], srcBbox[1], srcBbox[2], srcBbox[3]]
		renderBand = srcBand
		renderW = sampleSize.width
		renderH = sampleSize.height
	}

	// Apply viridis colormap to render band
	const dataUrl = renderToDataUrl(renderBand, renderW, renderH, min, max)

	const rawPixels: RasterPixels = { data: renderBand, width: renderW, height: renderH, min, max }

	return {
		kind: "raster",
		id,
		name,
		dataUrl,
		bounds: wgs84Bbox,
		opacity: 0.85,
		colormap: "viridis",
		rawPixels,
		metadata: {
			format: "geotiff",
			width: String(renderW),
			height: String(renderH),
			source_width: String(sourceWidth),
			source_height: String(sourceHeight),
			render_width: String(renderW),
			render_height: String(renderH),
			resampled:
				sourceWidth !== sampleSize.width || sourceHeight !== sampleSize.height
					? `${sourceWidth}x${sourceHeight} -> ${sampleSize.width}x${sampleSize.height}`
					: "no",
			raster_recolorable: "true",
			min: min.toFixed(4),
			max: max.toFixed(4),
			...(nodata !== null ? { nodata: String(nodata) } : {}),
			...(epsg && epsg !== 4326 && epsg !== 4269
				? { crs: `EPSG:${epsg}`, reprojected: reprojected ? "yes (pixel-warped)" : "no" }
				: {}),
		},
	}
}

function fitRasterSize(width: number, height: number): { width: number; height: number } {
	if (width <= 0 || height <= 0) {
		return { width: 1, height: 1 }
	}
	const dimScale = Math.min(1, MAX_TIFF_RENDER_DIM / Math.max(width, height))
	const pixelScale = Math.min(1, Math.sqrt(MAX_TIFF_RENDER_PIXELS / Math.max(1, width * height)))
	const scale = Math.min(dimScale, pixelScale)
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	}
}

function parseNoData(image: any): number | null {
	const raw =
		typeof image.getGDALNoData === "function"
			? image.getGDALNoData()
			: (image.getFileDirectory?.()?.GDAL_NODATA ?? image.fileDirectory?.GDAL_NODATA)
	if (raw === undefined || raw === null || raw === "") {
		return null
	}
	const parsed = typeof raw === "number" ? raw : Number(String(raw).trim())
	return Number.isFinite(parsed) ? parsed : null
}

function normalizeRasterBand(rasters: any, nodata: number | null): Float32Array {
	const firstBand = Array.isArray(rasters)
		? rasters[0]
		: ArrayBuffer.isView(rasters)
			? rasters
			: ArrayBuffer.isView(rasters?.[0])
				? rasters[0]
				: rasters
	const out = Float32Array.from(firstBand ?? [])
	if (nodata === null) {
		return out
	}
	for (let i = 0; i < out.length; i++) {
		if (Object.is(out[i], nodata) || Math.abs(out[i] - nodata) < 1e-9) {
			out[i] = NaN
		}
	}
	return out
}

/**
 * Warp source pixels from a projected CRS into WGS84 space via inverse projection.
 * Each output pixel is computed by transforming its WGS84 coordinates back to the
 * source CRS and bilinear-sampling the source band. Output is capped at 512px on
 * the long axis to keep runtime under ~1 second.
 */
async function warpPixelsToWgs84(
	srcBand: Float32Array,
	srcW: number,
	srcH: number,
	srcBbox: number[], // [minX, minY, maxX, maxY] in source CRS
	wgs84Bbox: [number, number, number, number],
	srcDef: string,
): Promise<{ data: Float32Array; width: number; height: number }> {
	const proj4 = (await import("proj4")).default

	const [srcMinX, srcMinY, srcMaxX, srcMaxY] = srcBbox
	const [minLon, minLat, maxLon, maxLat] = wgs84Bbox

	// Cap output resolution to keep warping time reasonable
	const MAX_DIM = 512
	const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH))
	const outW = Math.max(1, Math.round(srcW * scale))
	const outH = Math.max(1, Math.round(srcH * scale))

	const outData = new Float32Array(outW * outH)
	outData.fill(NaN)

	const lonRange = maxLon - minLon
	const latRange = maxLat - minLat
	const xRange = srcMaxX - srcMinX
	const yRange = srcMaxY - srcMinY

	// Build a proj4 converter once outside the pixel loop
	const converter = proj4("WGS84", srcDef)

	for (let row = 0; row < outH; row++) {
		// Yield to the UI thread every 64 rows to avoid blocking
		if (row > 0 && row % 64 === 0) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0))
		}

		const lat = maxLat - ((row + 0.5) / outH) * latRange

		for (let col = 0; col < outW; col++) {
			const lon = minLon + ((col + 0.5) / outW) * lonRange

			const [srcX, srcY] = converter.forward([lon, lat])

			// Map to source pixel coordinates (row 0 = north = srcMaxY)
			const px = ((srcX - srcMinX) / xRange) * (srcW - 1)
			const py = ((srcMaxY - srcY) / yRange) * (srcH - 1)

			if (px < 0 || px > srcW - 1 || py < 0 || py > srcH - 1) continue

			// Bilinear interpolation
			const x0 = Math.floor(px),
				x1 = Math.min(x0 + 1, srcW - 1)
			const y0 = Math.floor(py),
				y1 = Math.min(y0 + 1, srcH - 1)
			const fx = px - x0,
				fy = py - y0

			const v00 = srcBand[y0 * srcW + x0]
			const v10 = srcBand[y0 * srcW + x1]
			const v01 = srcBand[y1 * srcW + x0]
			const v11 = srcBand[y1 * srcW + x1]

			if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
				// Nearest-neighbour fallback when any sample is nodata
				const nearX = Math.min(srcW - 1, Math.round(px))
				const nearY = Math.min(srcH - 1, Math.round(py))
				outData[row * outW + col] = srcBand[nearY * srcW + nearX]
			} else {
				outData[row * outW + col] = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy
			}
		}
	}

	return { data: outData, width: outW, height: outH }
}

/** Render a Float32 band through the viridis ramp into a data URL. */
function renderToDataUrl(band: Float32Array, width: number, height: number, min: number, max: number): string {
	const canvas = document.createElement("canvas")
	canvas.width = width
	canvas.height = height
	const ctx = canvas.getContext("2d")!
	const imgData = ctx.createImageData(width, height)
	const ramp = viridisRamp()
	const range = max - min
	for (let i = 0; i < band.length; i++) {
		const v = band[i]
		const off = i * 4
		if (!Number.isFinite(v)) {
			imgData.data[off + 3] = 0
			continue
		}
		const t = (v - min) / range
		const [r, g, b] = sampleRamp(ramp, t)
		imgData.data[off] = r
		imgData.data[off + 1] = g
		imgData.data[off + 2] = b
		imgData.data[off + 3] = 230
	}
	ctx.putImageData(imgData, 0, 0)
	return canvas.toDataURL("image/png")
}

async function loadCsv(file: File, id: string, name: string): Promise<LayerSpec> {
	const text = await file.text()
	const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
	if (lines.length < 2) {
		throw new LayerLoadError(`${file.name} has no data rows.`)
	}
	const headers = splitCsvRow(lines[0])
	const lonIdx = pickColumnIndex(headers, ["lon", "longitude", "lng", "x"])
	const latIdx = pickColumnIndex(headers, ["lat", "latitude", "y"])
	if (lonIdx < 0 || latIdx < 0) {
		throw new LayerLoadError(
			`Couldn't find longitude/latitude columns in ${file.name}. Expected headers like "lon,lat" or "longitude,latitude".`,
		)
	}
	const features: any[] = []
	for (let i = 1; i < lines.length; i++) {
		const row = splitCsvRow(lines[i])
		const lon = parseFloat(row[lonIdx])
		const lat = parseFloat(row[latIdx])
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
			continue
		}
		const props: Record<string, string> = {}
		for (let j = 0; j < headers.length; j++) {
			if (j !== lonIdx && j !== latIdx) {
				props[headers[j]] = row[j] ?? ""
			}
		}
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: [lon, lat] },
			properties: props,
		})
	}
	if (features.length === 0) {
		throw new LayerLoadError(`No valid points in ${file.name}.`)
	}
	return {
		kind: "vector",
		id,
		name,
		geojson: JSON.stringify({ type: "FeatureCollection", features }),
		metadata: { format: "csv", rows: String(features.length) },
	}
}

// Lightweight CSV row splitter — handles quoted fields with commas inside.
function splitCsvRow(line: string): string[] {
	const out: string[] = []
	let cur = ""
	let inQuotes = false
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (inQuotes) {
			if (c === '"' && line[i + 1] === '"') {
				cur += '"'
				i++
			} else if (c === '"') {
				inQuotes = false
			} else {
				cur += c
			}
		} else if (c === '"') {
			inQuotes = true
		} else if (c === ",") {
			out.push(cur)
			cur = ""
		} else {
			cur += c
		}
	}
	out.push(cur)
	return out.map((s) => s.trim())
}

function pickColumnIndex(headers: string[], candidates: string[]): number {
	const lower = headers.map((h) => h.toLowerCase().trim())
	for (const c of candidates) {
		const idx = lower.indexOf(c)
		if (idx >= 0) {
			return idx
		}
	}
	return -1
}

// Compact viridis-like ramp — 5 stops, sufficient for preview rendering.
function viridisRamp(): number[][] {
	return [
		[68, 1, 84],
		[59, 82, 139],
		[33, 144, 141],
		[93, 201, 99],
		[253, 231, 37],
	]
}

function sampleRamp(ramp: number[][], t: number): [number, number, number] {
	const clamped = Math.max(0, Math.min(1, t))
	const x = clamped * (ramp.length - 1)
	const lo = Math.floor(x)
	const hi = Math.min(ramp.length - 1, lo + 1)
	const f = x - lo
	const a = ramp[lo]
	const b = ramp[hi]
	return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)]
}
