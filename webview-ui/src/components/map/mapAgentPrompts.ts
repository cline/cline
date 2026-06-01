/** CONUS bounding box (approx) for NLDI vs global delineation hints */
function isConus(lat: number, lon: number): boolean {
	return lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66
}

const LARGE_MERIT_BASIN_UPAREA_KM2 = 50_000

export interface MapAgentInspectContext {
	lat: number
	lon: number
	layerName?: string
	featureProperties?: Record<string, unknown>
	visibleLayerNames?: string[]
	selectedFeatureCount?: number
	selectedFeatureSummaries?: Array<{
		layerName: string
		properties: Record<string, unknown>
	}>
	userQuestion?: string
}

function formatCoords(lat: number, lon: number): string {
	const latStr = `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? "N" : "S"}`
	const lonStr = `${Math.abs(lon).toFixed(5)}°${lon >= 0 ? "E" : "W"}`
	return `${latStr}, ${lonStr}`
}

function formatFeatureProps(props?: Record<string, unknown>): string {
	if (!props || Object.keys(props).length === 0) {
		return "(no vector feature selected)"
	}
	const lines = Object.entries(props)
		.filter(([k]) => !k.startsWith("_"))
		.slice(0, 12)
		.map(([k, v]) => `  - ${k}: ${v}`)
	return lines.join("\n")
}

function formatLayers(names?: string[]): string {
	if (!names?.length) {
		return "(none reported)"
	}
	return names.map((n) => `  - ${n}`).join("\n")
}

function formatSelection(ctx: MapAgentInspectContext): string {
	if (!ctx.selectedFeatureCount) {
		return "(no multi-selection)"
	}
	const summaries = (ctx.selectedFeatureSummaries ?? []).slice(0, 8)
	const lines = [`- Count: ${ctx.selectedFeatureCount}`]
	for (const item of summaries) {
		const props = item.properties ?? {}
		const id = props.COMID ?? props.comid ?? props.id ?? props.ID ?? props.name ?? props.Name ?? "feature"
		const area = props.unitarea ?? props.uparea ?? props.area ?? props.Area
		lines.push(`  - ${item.layerName}: ${id}${area != null ? ` (area/uparea: ${area})` : ""}`)
	}
	if (ctx.selectedFeatureCount > summaries.length) {
		lines.push(`  - +${ctx.selectedFeatureCount - summaries.length} more selected features`)
	}
	return lines.join("\n")
}

export function buildDelineateAgentPrompt(ctx: MapAgentInspectContext): string {
	const conus = isConus(ctx.lat, ctx.lon)
	const uparea = ctx.featureProperties?.uparea ?? ctx.featureProperties?.UPAREA
	const upareaNumber = Number(uparea)
	const largeMeritBasin = Number.isFinite(upareaNumber) && upareaNumber > LARGE_MERIT_BASIN_UPAREA_KM2
	const comid = ctx.featureProperties?.COMID ?? ctx.featureProperties?.comid
	const methodHint = largeMeritBasin ? "merit_basins" : "auto"

	return [
		"Delineate the watershed for this map outlet and add the result to the map.",
		"",
		"## Outlet",
		`- Coordinates: ${formatCoords(ctx.lat, ctx.lon)}`,
		conus
			? "- Region: CONUS (NLDI may apply; still use delineate_watershed_from_point with method='auto')"
			: largeMeritBasin
				? "- Region: outside CONUS, large MERIT basin — use method='merit_basins' for hybrid routing."
				: "- Region: outside CONUS — use method='auto' (MERIT snap/routing; not NLDI)",
		"",
		"## Selected feature (if any)",
		`- Layer: ${ctx.layerName ?? "map click"}`,
		formatFeatureProps(ctx.featureProperties),
		uparea != null ? `- Segment upstream area (uparea): ${uparea} km² (may differ from pour-point basin)` : "",
		comid != null ? `- COMID: ${comid}` : "",
		"",
		"## Visible map layers",
		formatLayers(ctx.visibleLayerNames),
		"",
		"## Multi-selection",
		formatSelection(ctx),
		"",
		"## Instructions",
		`1. Call MCP tool \`delineate_watershed_from_point\` with the outlet lat/lon above, method='${methodHint}'. Do NOT pass session_id — it is auto-resolved from the chat context.`,
		Number.isFinite(upareaNumber) && upareaNumber > 0
			? `2. Pass expected_area_km2=${upareaNumber} to guide MERIT snapping.`
			: "2. If the basin looks too small/large, retry with expected_area_km2 when you can infer it.",
		largeMeritBasin
			? "3. If hybrid assets are missing, stage the needed regional MERIT-Basins vectors before retrying."
			: "3. Outside CONUS: MERIT river vectors must be installed/snapped — call merit_ensure_basin or merit_add_map_layers first if rivers are missing.",
		"4. Confirm the watershed polygon appears on the map (tool pushes layers automatically).",
		"5. Report area_km2, method_used, and pfaf_code in your reply.",
	]
		.filter(Boolean)
		.join("\n")
}

export function buildAskAboutMapAgentPrompt(ctx: MapAgentInspectContext): string {
	const question =
		ctx.userQuestion?.trim() ||
		"Interpret this outlet and visible map layers. Explain drainage area vs any selected river segment attributes, and suggest next steps (MERIT install, GEE MERIT/Hydro QA, etc.)."

	return [
		"The user clicked the AI-Hydro map and wants hydrology help for this location.",
		"",
		"## Outlet",
		`- Coordinates: ${formatCoords(ctx.lat, ctx.lon)}`,
		"",
		"## Selected feature",
		`- Layer: ${ctx.layerName ?? "none"}`,
		formatFeatureProps(ctx.featureProperties),
		"",
		"## Visible map layers",
		formatLayers(ctx.visibleLayerNames),
		"",
		"## Multi-selection",
		formatSelection(ctx),
		"",
		"## User question",
		question,
		"",
	].join("\n")
}

export interface MapBatchAnnotationsContext {
	csvTable: string
	userInstruction?: string
	visibleLayerNames?: string[]
}

export function buildBatchAnnotationsAgentPrompt(ctx: MapBatchAnnotationsContext): string {
	const instruction =
		ctx.userInstruction?.trim() ||
		"Please analyze these collected points/polygons based on visible layers and spatial context. Provide insights for the batch."

	return [
		"The user has collected a batch of spatial annotations on the AI-Hydro map.",
		"",
		"## Annotations Data",
		"Here is the data in CSV format:",
		"```csv",
		ctx.csvTable,
		"```",
		"",
		"## Visible map layers",
		formatLayers(ctx.visibleLayerNames),
		"",
		"## User Instructions",
		instruction,
		"",
		"Use map context and MCP tools (e.g. gee.preview_layer over the bounds, or spatial analysis tools) to analyze the batch.",
	].join("\n")
}

export interface MapAnnotationContext {
	annotation: {
		name: string
		/** Personal research notes — used as background context */
		notes: string
		/** Optional explicit agent instruction — used as primary task */
		aiPrompt: string
		tags: string[]
		type: "point" | "polygon" | "line"
		geometry: {
			type: "Point" | "Polygon" | "LineString"
			coordinates: number[] | number[][] | number[][][]
		}
		createdAt: string
		status?: string
		priority?: string | null
	}
	visibleLayerNames?: string[]
}

import type { MapLayer } from "@shared/proto/cline/map"
import { type MapTransect } from "./transectStorage"

function formatGeometrySummary(
	type: "point" | "polygon" | "line",
	geometry: MapAnnotationContext["annotation"]["geometry"],
): string {
	if (type === "point") {
		const [lon, lat] = geometry.coordinates as number[]
		return `- Type: Point\n- Coordinates: ${formatCoords(lat, lon)}`
	}
	if (type === "polygon") {
		const rings = geometry.coordinates as number[][][]
		const pts = rings[0] ?? []
		const lons = pts.map((p) => p[0])
		const lats = pts.map((p) => p[1])
		const minLon = Math.min(...lons)
		const maxLon = Math.max(...lons)
		const minLat = Math.min(...lats)
		const maxLat = Math.max(...lats)
		return [
			`- Type: Polygon (${pts.length - 1} vertices)`,
			`- Bounding box: ${formatCoords(minLat, minLon)} \u2192 ${formatCoords(maxLat, maxLon)}`,
			"- GeoJSON geometry:",
			"```json",
			JSON.stringify(geometry, null, 2),
			"```",
		].join("\n")
	}
	// line
	const pts = geometry.coordinates as number[][]
	const first = pts[0] ?? [0, 0]
	const last = pts[pts.length - 1] ?? [0, 0]
	return [
		`- Type: Line (${pts.length} vertices)`,
		`- Start: ${formatCoords(first[1], first[0])}`,
		`- End: ${formatCoords(last[1], last[0])}`,
		"- GeoJSON geometry:",
		"```json",
		JSON.stringify(geometry, null, 2),
		"```",
	].join("\n")
}

export function buildAnnotationAgentPrompt(ctx: MapAnnotationContext): string {
	const { annotation, visibleLayerNames } = ctx
	const hasNotes = annotation.notes?.trim()
	const hasTags = annotation.tags?.length
	const hasAiPrompt = annotation.aiPrompt?.trim()

	// If user wrote an explicit aiPrompt, use it as the primary task.
	// Otherwise fall back to a smart default, incorporating the notes as context.
	const primaryTask = hasAiPrompt
		? annotation.aiPrompt.trim()
		: hasNotes
			? `Based on my notes above and the visible map layers, please analyze this ${annotation.type} and provide relevant hydrological insights. If a computation is implied (e.g. extract raster values, delineate watershed, fetch upstream area), perform it using MCP tools.`
			: `Please analyze this ${annotation.type} annotation spatially in the context of the visible map layers. Provide relevant hydrological insights.`

	return [
		`The user has placed a **${annotation.type} annotation** named "${annotation.name}" on the AI-Hydro map and is requesting analysis.`,
		"",
		"## Annotation Details",
		`- Name: ${annotation.name}`,
		`- Created: ${annotation.createdAt}`,
		handle(annotation.status) ? `- Status: ${annotation.status}` : "",
		handle(annotation.priority) ? `- Priority: ${annotation.priority}` : "",
		hasTags ? `- Tags: ${annotation.tags.join(", ")}` : "",
		"",
		"## Location / Geometry",
		formatGeometrySummary(annotation.type, annotation.geometry),
		"",
		handle(hasNotes) ? "## Researcher Notes (background context)" : "",
		handle(hasNotes) ? annotation.notes.trim() : "",
		"",
		"## Visible Map Layers",
		formatLayers(visibleLayerNames),
		"",
		"## Primary Task",
		primaryTask,
		"",
		"## Instructions for Agent",
		"- Address the Primary Task directly, using the annotation geometry and researcher notes as context.",
		"- Cross-reference the visible map layers (e.g. relate to any visible watershed, raster, or boundary).",
		"- If the task implies a computation (extract raster values, delineate, fetch data), call the appropriate MCP tool.",
		"- For polygon or line annotations, use the full spatial extent or path, not just the centroid.",
		"- Be concise and action-oriented.",
	]
		.filter(Boolean)
		.join("\n")
}

function handle(v: string | null | undefined | boolean): boolean {
	return Boolean(v)
}

// ─────────────────────────────────────────────────────────────────────────────
// Transect Prompt Builder
// ─────────────────────────────────────────────────────────────────────────────

export interface MapTransectContext {
	transect: MapTransect
	profileData: { distKm: number; value: number }[]
	visibleLayers: MapLayer[]
}

export function buildTransectAgentPrompt(context: MapTransectContext): string {
	const { transect, profileData, visibleLayers } = context

	const promptLines = [
		`The user clicked the AI-Hydro map and wants hydrology help for this location.`,
		``,
		`## Selected Transect Profile`,
		`- Name: ${transect.name}`,
		`- Target Raster: ${transect.targetRasterId || "Unknown"}`,
		`- Length: ${profileData.length > 0 ? profileData[profileData.length - 1].distKm.toFixed(2) : 0} km`,
		`- Geometry: LineString with ${transect.geometry.coordinates.length} waypoints`,
		``,
	]

	if (transect.notes && transect.notes.trim().length > 0) {
		promptLines.push(`### Researcher Notes (background context)`)
		promptLines.push(transect.notes.trim())
		promptLines.push(``)
	}

	if (profileData.length > 0) {
		// Summarize the profile instead of sending 200 points
		const values = profileData.map((p) => p.value)
		const min = Math.min(...values)
		const max = Math.max(...values)
		const mean = values.reduce((a, b) => a + b, 0) / values.length

		promptLines.push(`### Profile Data Summary`)
		promptLines.push(`- Min Value: ${min.toFixed(3)}`)
		promptLines.push(`- Max Value: ${max.toFixed(3)}`)
		promptLines.push(`- Mean Value: ${mean.toFixed(3)}`)
		promptLines.push(`- Sample Points: ${profileData.length}`)
		promptLines.push(``)

		// Send a decimated version of the profile (e.g. 20 points) so the agent can see the shape
		const step = Math.max(1, Math.floor(profileData.length / 20))
		promptLines.push(`### Profile Shape (Sampled)`)
		promptLines.push(`Dist (km) | Value`)
		promptLines.push(`----------|-------`)
		for (let i = 0; i < profileData.length; i += step) {
			promptLines.push(`${profileData[i].distKm.toFixed(2).padStart(9)} | ${profileData[i].value.toFixed(3)}`)
		}
		if ((profileData.length - 1) % step !== 0) {
			const last = profileData[profileData.length - 1]
			promptLines.push(`${last.distKm.toFixed(2).padStart(9)} | ${last.value.toFixed(3)}`)
		}
		promptLines.push(``)
	}

	promptLines.push(formatVisibleLayers(visibleLayers))

	if (transect.aiPrompt && transect.aiPrompt.trim().length > 0) {
		promptLines.push(`## Primary Task`)
		promptLines.push(transect.aiPrompt.trim())
	} else {
		promptLines.push(`## User question`)
		promptLines.push(
			`Interpret this cross-sectional profile. Identify key hydrological features such as channels, floodplains, or ridges. Explain how this profile relates to the surrounding visible layers and suggest next steps.`,
		)
	}

	return promptLines.join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Transect Prompt Builder
// ─────────────────────────────────────────────────────────────────────────────

export interface MapBatchTransectsContext {
	/** CSV table of transects + profile statistics (one row per transect). */
	csvTable: string
	userInstruction?: string
	visibleLayers: MapLayer[]
}

export function buildBatchTransectsAgentPrompt(ctx: MapBatchTransectsContext): string {
	const instruction =
		ctx.userInstruction?.trim() ||
		"Compare these cross-sectional profiles. Identify shared and contrasting hydrological features (channels, floodplains, ridges), rank them, and suggest follow-up analysis."

	return [
		"The user has collected a batch of cross-sectional transect profiles on the AI-Hydro map.",
		"",
		"## Transects Data",
		"Each row summarizes one transect and the raster profile sampled beneath it (distances in km; min/max/mean are raster values along the line):",
		"```csv",
		ctx.csvTable,
		"```",
		"",
		formatVisibleLayers(ctx.visibleLayers),
		"## User Instructions",
		instruction,
		"",
		"Use the profile statistics and visible map layers to analyze the batch. Where a computation is implied, call the appropriate MCP tool.",
	].join("\n")
}
