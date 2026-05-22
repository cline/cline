/** CONUS bounding box (approx) for NLDI vs global delineation hints */
function isConus(lat: number, lon: number): boolean {
	return lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66
}

export interface MapAgentInspectContext {
	lat: number
	lon: number
	layerName?: string
	featureProperties?: Record<string, unknown>
	visibleLayerNames?: string[]
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

export function buildDelineateAgentPrompt(ctx: MapAgentInspectContext): string {
	const conus = isConus(ctx.lat, ctx.lon)
	const uparea = ctx.featureProperties?.uparea ?? ctx.featureProperties?.UPAREA
	const comid = ctx.featureProperties?.COMID ?? ctx.featureProperties?.comid

	return [
		"Delineate the watershed for this map outlet and add the result to the map.",
		"",
		"## Outlet",
		`- Coordinates: ${formatCoords(ctx.lat, ctx.lon)}`,
		conus
			? "- Region: CONUS (NLDI may apply; still use delineate_watershed_from_point with method='auto')"
			: "- Region: outside CONUS — use method='auto' (cloud DEM + MERIT snap; not NLDI)",
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
		"## Instructions",
		"1. Call MCP tool `delineate_watershed_from_point` with session_id='map', the outlet lat/lon above, method='auto'.",
		uparea != null && Number(uparea) > 0
			? `2. Pass expected_area_km2=${Number(uparea)} if it helps snapping (optional).`
			: "2. If the basin looks too small/large, retry with expected_area_km2 when you can infer it.",
		"3. Outside CONUS: MERIT river vectors must be installed/snapped — call merit_ensure_basin or merit_add_map_layers first if rivers are missing.",
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
		"## User question",
		question,
		"",
		"Use map context and MCP tools as needed (e.g. merit_ensure_basin, merit_add_map_layers, gee.preview_layer on MERIT/Hydro bands over the basin ROI).",
	].join("\n")
}
