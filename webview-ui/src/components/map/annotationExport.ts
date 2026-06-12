/**
 * annotationExport.ts
 * Multi-format export for Smart Map Annotations.
 *
 * Formats:
 *  - CSV        (via annotationStorage)
 *  - GeoJSON    (FeatureCollection)
 *  - KML        (plain text)
 *  - KMZ        (KML zipped via jszip)
 *  - Markdown   (research report)
 */

import type { AnnotationCollection, MapAnnotation } from "./annotationStorage"
import { annotationCenter, triggerDownload } from "./annotationStorage"

// ─── Coord formatting ─────────────────────────────────────────────────────────

function fmtCoord(lat: number, lon: number): string {
	const latStr = `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? "N" : "S"}`
	const lonStr = `${Math.abs(lon).toFixed(5)}°${lon >= 0 ? "E" : "W"}`
	return `${latStr}, ${lonStr}`
}

// ─── GeoJSON ─────────────────────────────────────────────────────────────────

export function exportAnnotationsGeoJson(annotations: MapAnnotation[], filename = "aihydro_annotations.geojson"): void {
	const fc = {
		type: "FeatureCollection",
		features: annotations.map((ann) => ({
			type: "Feature",
			geometry: ann.geometry,
			properties: {
				id: ann.id,
				name: ann.name,
				notes: ann.notes,
				ai_prompt: ann.aiPrompt,
				tags: ann.tags.join(";"),
				photos: ann.images.join(";"),
				status: ann.status,
				priority: ann.priority,
				color: ann.color,
				annotation_type: ann.type,
				collection_ids: ann.collectionIds.join(";"),
				created_at: ann.createdAt,
				updated_at: ann.updatedAt,
			},
		})),
	}
	triggerDownload(new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" }), filename)
}

// ─── KML ─────────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function colorToKmlABGR(hex: string): string {
	// KML colour is AABBGGRR
	const h = hex.replace("#", "").padStart(6, "0")
	const r = h.slice(0, 2)
	const g = h.slice(2, 4)
	const b = h.slice(4, 6)
	return `ff${b}${g}${r}`
}

function coordsToKml(geometry: MapAnnotation["geometry"]): string {
	if (geometry.type === "Point") {
		const [lon, lat] = geometry.coordinates as number[]
		return `<Point><coordinates>${lon},${lat},0</coordinates></Point>`
	}
	if (geometry.type === "LineString") {
		const coords = (geometry.coordinates as number[][]).map(([lon, lat]) => `${lon},${lat},0`).join(" ")
		return `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>`
	}
	// Polygon
	const rings = geometry.coordinates as number[][][]
	const outerCoords = (rings[0] ?? []).map(([lon, lat]) => `${lon},${lat},0`).join(" ")
	return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${outerCoords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`
}

function buildKml(annotations: MapAnnotation[], title = "AI-Hydro Annotations"): string {
	const placemarks = annotations.map((ann) => {
		const kmlColor = colorToKmlABGR(ann.color)
		const desc = [
			ann.notes ? `Notes: ${xmlEscape(ann.notes)}` : "",
			ann.aiPrompt ? `AI Prompt: ${xmlEscape(ann.aiPrompt)}` : "",
			ann.tags.length ? `Tags: ${xmlEscape(ann.tags.join(", "))}` : "",
			`Status: ${ann.status}`,
			ann.priority ? `Priority: ${ann.priority}` : "",
			`Created: ${ann.createdAt}`,
		]
			.filter(Boolean)
			.join("\n")

		return `  <Placemark>
    <name>${xmlEscape(ann.name)}</name>
    <description><![CDATA[${desc}]]></description>
    <Style>
      <IconStyle><color>${kmlColor}</color></IconStyle>
      <LineStyle><color>${kmlColor}</color><width>2</width></LineStyle>
      <PolyStyle><color>66${kmlColor.slice(2)}</color></PolyStyle>
    </Style>
    ${coordsToKml(ann.geometry)}
  </Placemark>`
	})

	return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(title)}</name>
${placemarks.join("\n")}
  </Document>
</kml>`
}

export function exportAnnotationsKml(
	annotations: MapAnnotation[],
	title = "AI-Hydro Annotations",
	filename = "aihydro_annotations.kml",
): void {
	const kml = buildKml(annotations, title)
	triggerDownload(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), filename)
}

export async function exportAnnotationsKmz(
	annotations: MapAnnotation[],
	title = "AI-Hydro Annotations",
	filename = "aihydro_annotations.kmz",
): Promise<void> {
	const kml = buildKml(annotations, title)
	try {
		const { default: JSZip } = await import("jszip")
		const zip = new JSZip()
		zip.file("doc.kml", kml)
		const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
		triggerDownload(blob, filename)
	} catch {
		// Fallback to plain KML if jszip unavailable
		exportAnnotationsKml(annotations, title, filename.replace(".kmz", ".kml"))
	}
}

// ─── Shapefile (lightweight native implementation) ────────────────────────────
// Generates a .zip containing .shp, .dbf, .shx, .prj for point layers.
// Polygon and line support uses the same pattern.

function writeInt32LE(val: number): ArrayBuffer {
	const buf = new ArrayBuffer(4)
	new DataView(buf).setInt32(0, val, true)
	return buf
}
function writeInt32BE(val: number): ArrayBuffer {
	const buf = new ArrayBuffer(4)
	new DataView(buf).setInt32(0, val, false)
	return buf
}
function writeFloat64LE(val: number): ArrayBuffer {
	const buf = new ArrayBuffer(8)
	new DataView(buf).setFloat64(0, val, true)
	return buf
}

function concatArrayBuffers(parts: ArrayBuffer[]): ArrayBuffer {
	const total = parts.reduce((s, p) => s + p.byteLength, 0)
	const out = new Uint8Array(total)
	let offset = 0
	for (const p of parts) {
		out.set(new Uint8Array(p), offset)
		offset += p.byteLength
	}
	return out.buffer
}

/** Encode a string padded to `length` bytes in ISO-8859-1 */
function dbfString(s: string, length: number): Uint8Array {
	const arr = new Uint8Array(length)
	for (let i = 0; i < length; i++) {
		arr[i] = i < s.length ? s.charCodeAt(i) & 0xff : 0x20
	}
	return arr
}

function buildDbf(annotations: MapAnnotation[]): ArrayBuffer {
	// Fields: NAME(C,64), NOTES(C,128), STATUS(C,16), PRIORITY(C,8), TAGS(C,128), COLOR(C,8)
	const fields: Array<{ name: string; type: string; length: number }> = [
		{ name: "NAME", type: "C", length: 64 },
		{ name: "NOTES", type: "C", length: 128 },
		{ name: "STATUS", type: "C", length: 16 },
		{ name: "PRIORITY", type: "C", length: 8 },
		{ name: "TAGS", type: "C", length: 128 },
		{ name: "COLOR", type: "C", length: 8 },
	]
	const recordSize = 1 + fields.reduce((s, f) => s + f.length, 0) // 1 for deletion flag
	const headerSize = 32 + fields.length * 32 + 1

	const header = new Uint8Array(headerSize)
	const view = new DataView(header.buffer)
	header[0] = 0x03 // dBASE III
	const now = new Date()
	header[1] = now.getFullYear() - 1900
	header[2] = now.getMonth() + 1
	header[3] = now.getDate()
	view.setInt32(4, annotations.length, true)
	view.setInt16(8, headerSize, true)
	view.setInt16(10, recordSize, true)

	// Field descriptors
	for (let i = 0; i < fields.length; i++) {
		const offset = 32 + i * 32
		const f = fields[i]
		const nameBytes = dbfString(f.name, 11)
		header.set(nameBytes, offset)
		header[offset + 11] = f.type.charCodeAt(0)
		header[offset + 16] = f.length
	}
	header[headerSize - 1] = 0x0d // header terminator

	// Records
	const records = new Uint8Array(annotations.length * recordSize)
	for (let r = 0; r < annotations.length; r++) {
		const ann = annotations[r]
		let pos = r * recordSize
		records[pos++] = 0x20 // not deleted
		const vals = [ann.name, ann.notes, ann.status, ann.priority ?? "", ann.tags.join(";"), ann.color]
		for (let fi = 0; fi < fields.length; fi++) {
			const str = dbfString(vals[fi] ?? "", fields[fi].length)
			records.set(str, pos)
			pos += fields[fi].length
		}
	}

	return concatArrayBuffers([header.buffer, records.buffer])
}

function buildShpForPoints(annotations: MapAnnotation[]): { shp: ArrayBuffer; shx: ArrayBuffer } {
	// Only export the centroid for all types for simplicity
	const points = annotations.map((ann) => annotationCenter(ann))

	// Each record: 8 bytes header + 20 bytes content = 28 bytes
	const recordLen = 28 // in bytes (14 16-bit words)
	const contentLen = 100 + points.length * recordLen

	const shp = new Uint8Array(contentLen)
	const shpView = new DataView(shp.buffer)

	// File header
	shpView.setInt32(0, 9994, false) // file code
	shpView.setInt32(24, contentLen / 2, false) // file length in 16-bit words
	shpView.setInt32(28, 1000, true) // version
	shpView.setInt32(32, 1, true) // shape type = Point

	// Bounding box
	if (points.length > 0) {
		const lons = points.map((p) => p[0])
		const lats = points.map((p) => p[1])
		shpView.setFloat64(36, Math.min(...lons), true)
		shpView.setFloat64(44, Math.min(...lats), true)
		shpView.setFloat64(52, Math.max(...lons), true)
		shpView.setFloat64(60, Math.max(...lats), true)
	}

	// Records
	const shxRecords: number[] = []
	let offset = 100
	for (let i = 0; i < points.length; i++) {
		const [lon, lat] = points[i]
		shpView.setInt32(offset, i + 1, false) // record number (1-based, big-endian)
		shpView.setInt32(offset + 4, 10, false) // content length in 16-bit words
		shpView.setInt32(offset + 8, 1, true) // shape type Point
		shpView.setFloat64(offset + 12, lon, true)
		shpView.setFloat64(offset + 20, lat, true)
		shxRecords.push(offset / 2) // offset in 16-bit words
		offset += recordLen
	}

	// SHX: 100-byte header + 8 bytes per record
	const shxLen = 100 + shxRecords.length * 8
	const shx = new Uint8Array(shxLen)
	const shxView = new DataView(shx.buffer)
	shxView.setInt32(0, 9994, false)
	shxView.setInt32(24, shxLen / 2, false)
	shxView.setInt32(28, 1000, true)
	shxView.setInt32(32, 1, true)
	for (let i = 0; i < shxRecords.length; i++) {
		shxView.setInt32(100 + i * 8, shxRecords[i], false)
		shxView.setInt32(104 + i * 8, 10, false) // content length
	}

	return { shp: shp.buffer, shx: shx.buffer }
}

const PRJ_WGS84 =
	'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

export async function exportAnnotationsShapefile(
	annotations: MapAnnotation[],
	filename = "aihydro_annotations_shp.zip",
): Promise<void> {
	try {
		const { default: JSZip } = await import("jszip")
		const zip = new JSZip()
		const { shp, shx } = buildShpForPoints(annotations)
		const dbf = buildDbf(annotations)
		zip.file("annotations.shp", shp)
		zip.file("annotations.shx", shx)
		zip.file("annotations.dbf", dbf)
		zip.file("annotations.prj", PRJ_WGS84)
		const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
		triggerDownload(blob, filename)
	} catch (err) {
		console.error("Shapefile export failed:", err)
		// Fallback to GeoJSON
		exportAnnotationsGeoJson(annotations, filename.replace("_shp.zip", ".geojson"))
	}
}

// ─── Markdown report ─────────────────────────────────────────────────────────

export function exportAnnotationsMarkdown(
	annotations: MapAnnotation[],
	collectionName = "AI-Hydro Annotations",
	filename = "aihydro_annotations_report.md",
): void {
	const now = new Date().toLocaleString()
	const lines: string[] = [
		`# ${collectionName}`,
		``,
		`> Generated by AI-Hydro on ${now}`,
		`> ${annotations.length} annotation${annotations.length !== 1 ? "s" : ""}`,
		``,
		`---`,
		``,
	]

	for (const ann of annotations) {
		const [lon, lat] = annotationCenter(ann)
		lines.push(`## ${ann.name}`)
		lines.push(``)
		lines.push(`| Field | Value |`)
		lines.push(`|---|---|`)
		lines.push(`| Type | ${ann.type} |`)
		lines.push(`| Coordinates | ${fmtCoord(lat, lon)} |`)
		lines.push(`| Status | ${ann.status} |`)
		if (ann.priority) lines.push(`| Priority | ${ann.priority} |`)
		if (ann.tags.length) lines.push(`| Tags | ${ann.tags.join(", ")} |`)
		lines.push(`| Created | ${ann.createdAt} |`)
		lines.push(``)
		if (ann.notes) {
			lines.push(`### Notes`)
			lines.push(``)
			lines.push(ann.notes)
			lines.push(``)
		}
		if (ann.aiPrompt) {
			lines.push(`### AI Instructions`)
			lines.push(``)
			lines.push(`> ${ann.aiPrompt}`)
			lines.push(``)
		}
		lines.push(`---`)
		lines.push(``)
	}

	triggerDownload(new Blob([lines.join("\n")], { type: "text/markdown" }), filename)
}

// ─── Convenience dispatcher ───────────────────────────────────────────────────

export type ExportFormat = "csv" | "geojson" | "kml" | "kmz" | "shapefile" | "markdown"

export async function exportAnnotations(
	format: ExportFormat,
	annotations: MapAnnotation[],
	collection?: AnnotationCollection,
): Promise<void> {
	const slug = collection ? collection.name.replace(/\s+/g, "_").toLowerCase() : "annotations"
	switch (format) {
		case "csv":
			// imported from annotationStorage
			const { exportAnnotationsCsv } = await import("./annotationStorage")
			exportAnnotationsCsv(annotations, `aihydro_${slug}.csv`)
			break
		case "geojson":
			exportAnnotationsGeoJson(annotations, `aihydro_${slug}.geojson`)
			break
		case "kml":
			exportAnnotationsKml(annotations, collection?.name ?? "AI-Hydro Annotations", `aihydro_${slug}.kml`)
			break
		case "kmz":
			await exportAnnotationsKmz(annotations, collection?.name ?? "AI-Hydro Annotations", `aihydro_${slug}.kmz`)
			break
		case "shapefile":
			await exportAnnotationsShapefile(annotations, `aihydro_${slug}_shp.zip`)
			break
		case "markdown":
			exportAnnotationsMarkdown(annotations, collection?.name ?? "AI-Hydro Annotations", `aihydro_${slug}_report.md`)
			break
	}
}
