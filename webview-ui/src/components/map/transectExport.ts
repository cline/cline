import type { MapTransect, TransectCollection } from "./transectStorage"

export type ExportFormat = "csv" | "geojson" | "kml" | "md" | "profile_pts"

export interface ProfilePoint {
	distKm: number
	value: number
	lon?: number
	lat?: number
}

export type ProfileDataMap = Record<string, ProfilePoint[]>

interface ProfileStats {
	count: number
	lengthKm: number
	min: number
	max: number
	mean: number
}

function profileStats(profile: ProfilePoint[] | undefined): ProfileStats | null {
	if (!profile || profile.length === 0) return null
	const values = profile.map((p) => p.value)
	const sum = values.reduce((a, b) => a + b, 0)
	return {
		count: profile.length,
		lengthKm: profile[profile.length - 1].distKm,
		min: Math.min(...values),
		max: Math.max(...values),
		mean: sum / values.length,
	}
}

function csvCell(value: string | number): string {
	const s = String(value ?? "")
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildProfilePointsCsv(transects: MapTransect[], profiles: ProfileDataMap): string {
	const header = ["transect_id", "transect_name", "sample_index", "dist_km", "lon", "lat", "value"]
	const rows: string[] = []
	for (const t of transects) {
		const pts = profiles[t.id] ?? []
		pts.forEach((p, i) => {
			const withCoords = p as ProfilePoint & { lon?: number; lat?: number }
			rows.push(
				[
					t.id,
					t.name,
					i,
					p.distKm.toFixed(6),
					withCoords.lon?.toFixed(7) ?? "",
					withCoords.lat?.toFixed(7) ?? "",
					p.value,
				]
					.map(csvCell)
					.join(","),
			)
		})
	}
	return [header.join(","), ...rows].join("\n")
}

function triggerDownload(content: string, filename: string, mime: string) {
	const blob = new Blob([content], { type: mime })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}

function buildCsv(transects: MapTransect[], profiles?: ProfileDataMap): string {
	const header = [
		"id",
		"name",
		"status",
		"priority",
		"tags",
		"color",
		"waypoints",
		"start_lon",
		"start_lat",
		"end_lon",
		"end_lat",
		"length_km",
		"min",
		"max",
		"mean",
		"sample_count",
		"notes",
		"ai_prompt",
		"created_at",
	]
	const rows = transects.map((t) => {
		const coords = t.geometry.coordinates
		const start = coords[0] ?? [NaN, NaN]
		const end = coords[coords.length - 1] ?? [NaN, NaN]
		const stats = profileStats(profiles?.[t.id])
		return [
			t.id,
			t.name,
			t.status,
			t.priority ?? "",
			t.tags.join("; "),
			t.color,
			coords.length,
			start[0],
			start[1],
			end[0],
			end[1],
			stats ? stats.lengthKm.toFixed(4) : "",
			stats ? stats.min.toFixed(4) : "",
			stats ? stats.max.toFixed(4) : "",
			stats ? stats.mean.toFixed(4) : "",
			stats ? stats.count : "",
			t.notes,
			t.aiPrompt,
			t.createdAt,
		]
			.map(csvCell)
			.join(",")
	})
	return [header.join(","), ...rows].join("\n")
}

function buildGeoJson(transects: MapTransect[], profiles?: ProfileDataMap): string {
	const features = transects.map((t) => {
		const stats = profileStats(profiles?.[t.id])
		return {
			type: "Feature" as const,
			geometry: t.geometry,
			properties: {
				id: t.id,
				name: t.name,
				status: t.status,
				priority: t.priority,
				tags: t.tags,
				color: t.color,
				notes: t.notes,
				aiPrompt: t.aiPrompt,
				targetRasterId: t.targetRasterId,
				createdAt: t.createdAt,
				...(stats && {
					lengthKm: stats.lengthKm,
					profileMin: stats.min,
					profileMax: stats.max,
					profileMean: stats.mean,
					profileSamples: stats.count,
				}),
			},
		}
	})
	return JSON.stringify({ type: "FeatureCollection", features }, null, 2)
}

function buildKml(transects: MapTransect[]): string {
	const placemarks = transects
		.map((t) => {
			const coordStr = t.geometry.coordinates.map(([lon, lat]) => `${lon},${lat},0`).join(" ")
			const desc = [t.notes, t.aiPrompt].filter(Boolean).join("\n\n")
			return [
				"    <Placemark>",
				`      <name>${escapeXml(t.name)}</name>`,
				desc ? `      <description>${escapeXml(desc)}</description>` : "",
				`      <Style><LineStyle><color>ff${hexToKmlColor(t.color)}</color><width>3</width></LineStyle></Style>`,
				"      <LineString>",
				`        <coordinates>${coordStr}</coordinates>`,
				"      </LineString>",
				"    </Placemark>",
			]
				.filter(Boolean)
				.join("\n")
		})
		.join("\n")
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<kml xmlns="http://www.opengis.net/kml/2.2">',
		"  <Document>",
		"    <name>AI-Hydro Transects</name>",
		placemarks,
		"  </Document>",
		"</kml>",
	].join("\n")
}

function buildMarkdown(transects: MapTransect[], profiles: ProfileDataMap | undefined, collection?: TransectCollection): string {
	const lines: string[] = []
	lines.push(`# Transect Report${collection ? ` — ${collection.name}` : ""}`)
	lines.push("")
	lines.push(`_Generated ${new Date().toLocaleString()} · ${transects.length} transect${transects.length !== 1 ? "s" : ""}_`)
	lines.push("")
	for (const t of transects) {
		const stats = profileStats(profiles?.[t.id])
		lines.push(`## ${t.name}`)
		lines.push("")
		lines.push(`- **Status:** ${t.status}${t.priority ? ` · **Priority:** ${t.priority}` : ""}`)
		if (t.tags.length) lines.push(`- **Tags:** ${t.tags.map((x) => `#${x}`).join(" ")}`)
		lines.push(`- **Waypoints:** ${t.geometry.coordinates.length}`)
		if (stats) {
			lines.push(`- **Length:** ${stats.lengthKm.toFixed(2)} km`)
			lines.push(
				`- **Profile:** min ${stats.min.toFixed(3)} · max ${stats.max.toFixed(3)} · mean ${stats.mean.toFixed(3)} (${stats.count} samples)`,
			)
		}
		if (t.notes) {
			lines.push("")
			lines.push(`> ${t.notes.replace(/\n/g, "\n> ")}`)
		}
		lines.push("")
	}
	return lines.join("\n")
}

function escapeXml(s: string): string {
	return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string)
}

// "#rrggbb" -> KML "bbggrr"
function hexToKmlColor(hex: string): string {
	const h = hex.replace("#", "")
	if (h.length !== 6) return "ff7300"
	return h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2)
}

export async function exportTransects(
	format: ExportFormat,
	transects: MapTransect[],
	profiles?: ProfileDataMap,
	collection?: TransectCollection,
): Promise<void> {
	if (transects.length === 0) return
	const stamp = new Date().toISOString().slice(0, 10)
	const base = `transects-${stamp}`
	switch (format) {
		case "csv":
			triggerDownload(buildCsv(transects, profiles), `${base}.csv`, "text/csv")
			break
		case "geojson":
			triggerDownload(buildGeoJson(transects, profiles), `${base}.geojson`, "application/geo+json")
			break
		case "kml":
			triggerDownload(buildKml(transects), `${base}.kml`, "application/vnd.google-earth.kml+xml")
			break
		case "md":
			triggerDownload(buildMarkdown(transects, profiles, collection), `${base}.md`, "text/markdown")
			break
		case "profile_pts":
			triggerDownload(buildProfilePointsCsv(transects, profiles ?? {}), `${base}-points.csv`, "text/csv")
			break
	}
}
