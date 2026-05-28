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
		"Use map context and MCP tools as needed (e.g. merit_ensure_basin, merit_add_map_layers, gee.preview_layer on MERIT/Hydro bands over the basin ROI).",
	].join("\n")
}
