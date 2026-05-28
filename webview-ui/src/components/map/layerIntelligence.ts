import type { MapLayer } from "@shared/proto/cline/map"

export type LayerDataState =
	| "raw_vector"
	| "analysis_ready_raster"
	| "visual_preview_raster"
	| "remote_raster"
	| "reference_vector"
	| "analysis_output"
	| "unknown"

export type LayerCapability =
	| "identify"
	| "hover_highlight"
	| "style_basic"
	| "style_graduated"
	| "style_raster"
	| "attributes"
	| "raster_probe"
	| "export_geojson"
	| "export_image"
	| "provenance"
	| "agent_context"
	| "plate_export"

export type LayerQualityWarning =
	| "VISUAL_PREVIEW_ONLY"
	| "CAPTURE_ONLY_EXPORT"
	| "MISSING_PROVENANCE"
	| "MISSING_CITATION"
	| "REMOTE_LAYER"
	| "UNSUPPORTED_SYMBOLOGY"

export interface LayerIntelligence {
	dataState: LayerDataState
	typeLabel: string
	statusLabel: string
	statusDetail: string
	capabilities: Set<LayerCapability>
	warnings: LayerQualityWarning[]
	provenancePath?: string
	citation?: string
	license?: string
	sourceLabel: string
}

interface DeriveOptions {
	rawRasterValuesAvailable?: boolean
}

const VECTOR_TYPES = new Set(["point", "line", "polygon", "vector", "geojson"])

export function deriveLayerIntelligence(layer: MapLayer, options: DeriveOptions = {}): LayerIntelligence {
	const meta = layer.metadata ?? {}
	const layerType = (layer.layerType ?? "").toLowerCase()
	const source = (meta.source ?? "").toLowerCase()
	const capabilities = new Set<LayerCapability>(["agent_context", "plate_export"])
	const warnings: LayerQualityWarning[] = []
	const provenancePath = meta.provenance_path || meta.provenancePath
	const citation = meta.citation || meta.dataset_citation || meta.merit_citation
	const license = meta.license || meta.dataset_license || meta.merit_license
	const isVector = VECTOR_TYPES.has(layerType) && Boolean(layer.geojson?.trim())
	const isMerit = source === "merit" || Boolean(meta.merit_layer)
	const isAnalysisOutput = Boolean(meta.tool || meta._run_id || source === "tool" || source === "session")
	const hasRawRaster =
		options.rawRasterValuesAvailable === true ||
		meta.raster_recolorable === "true" ||
		meta.raw_raster_values === "true" ||
		meta.raster_value_access === "raw"

	if (provenancePath) capabilities.add("provenance")
	if (!provenancePath && isAnalysisOutput) warnings.push("MISSING_PROVENANCE")

	if (isVector) {
		capabilities.add("identify")
		capabilities.add("hover_highlight")
		capabilities.add("style_basic")
		capabilities.add("attributes")
		capabilities.add("export_geojson")
		if (layerType !== "point") capabilities.add("style_graduated")
		if (isMerit && !citation) warnings.push("MISSING_CITATION")
		return {
			dataState: isMerit ? "reference_vector" : isAnalysisOutput ? "analysis_output" : "raw_vector",
			typeLabel: isMerit ? "Reference vector" : "Vector",
			statusLabel: isMerit ? "Reference data" : isAnalysisOutput ? "Analysis output" : "Editable vector",
			statusDetail: isMerit
				? "MERIT-Basins reference geometry; inspect provenance before publication."
				: "Feature geometry is available for identify, styling, attributes, and GeoJSON export.",
			capabilities,
			warnings,
			provenancePath,
			citation,
			license,
			sourceLabel: sourceLabel(layer),
		}
	}

	if (layerType === "raster") {
		capabilities.add("export_image")
		if (hasRawRaster) {
			capabilities.add("style_raster")
			capabilities.add("raster_probe")
			return {
				dataState: "analysis_ready_raster",
				typeLabel: "Raster",
				statusLabel: "Analysis-ready raster",
				statusDetail: "Raw raster values are loaded; colormap editing and value probing are available.",
				capabilities,
				warnings,
				provenancePath,
				citation,
				license,
				sourceLabel: sourceLabel(layer),
			}
		}
		warnings.push("VISUAL_PREVIEW_ONLY", "CAPTURE_ONLY_EXPORT")
		return {
			dataState: "visual_preview_raster",
			typeLabel: "Raster preview",
			statusLabel: "Visual preview only",
			statusDetail: "Only a rendered image is loaded. Load raster values to enable colormap editing and value probing.",
			capabilities,
			warnings,
			provenancePath,
			citation,
			license,
			sourceLabel: sourceLabel(layer),
		}
	}

	if (layerType === "gee_tile") {
		capabilities.add("export_image")
		warnings.push("REMOTE_LAYER", "CAPTURE_ONLY_EXPORT")
		return {
			dataState: "remote_raster",
			typeLabel: "Remote raster",
			statusLabel: "Remote raster layer",
			statusDetail: "Rendered from a remote tile service; export is capture-based unless a local artifact is generated.",
			capabilities,
			warnings,
			provenancePath,
			citation,
			license,
			sourceLabel: sourceLabel(layer),
		}
	}

	warnings.push("UNSUPPORTED_SYMBOLOGY")
	return {
		dataState: "unknown",
		typeLabel: layer.layerType || "Layer",
		statusLabel: "Limited layer",
		statusDetail: "AI-Hydro can show this layer, but advanced styling and export support are limited.",
		capabilities,
		warnings,
		provenancePath,
		citation,
		license,
		sourceLabel: sourceLabel(layer),
	}
}

export function warningText(warning: LayerQualityWarning): string {
	switch (warning) {
		case "VISUAL_PREVIEW_ONLY":
			return "Values not loaded"
		case "CAPTURE_ONLY_EXPORT":
			return "Capture-only export"
		case "MISSING_PROVENANCE":
			return "Missing provenance"
		case "MISSING_CITATION":
			return "Missing citation"
		case "REMOTE_LAYER":
			return "Remote layer"
		case "UNSUPPORTED_SYMBOLOGY":
			return "Limited styling"
	}
}

function sourceLabel(layer: MapLayer): string {
	const meta = layer.metadata ?? {}
	const source = meta.source
	if (source === "gee") return "Google Earth Engine"
	if (source === "workspace") return "Workspace"
	if (source === "merit") return "MERIT-Basins"
	if (source === "user") return "Loaded file"
	if (meta.tool) return meta.tool
	if (meta.path) return meta.path.split(/[\\/]/).pop() ?? meta.path
	return "Map session"
}
