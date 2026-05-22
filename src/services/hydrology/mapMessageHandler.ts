import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import type { MeritLayerSpec } from "./types"

const STYLE_PRESETS: Record<string, Partial<MapLayerStyle>> = {
	watershed: {
		fillColor: "#1a6eb5",
		fillOpacity: 0.2,
		strokeColor: "#0d4a80",
		strokeWidth: 3,
		color: "#0d4a80",
		opacity: 1,
	},
	flowlines: {
		fillOpacity: 0,
		strokeColor: "#1a73e8",
		strokeWidth: 2,
		color: "#1a73e8",
		opacity: 0.85,
	},
	huc: {
		fillColor: "#7c3aed",
		fillOpacity: 0.12,
		strokeColor: "#a78bfa",
		strokeWidth: 1.5,
		color: "#a78bfa",
		opacity: 0.9,
	},
	gauge: {
		fillColor: "#f59e0b",
		fillOpacity: 0.9,
		strokeColor: "#b45309",
		strokeWidth: 2,
		color: "#f59e0b",
		opacity: 1,
	},
	dam: {
		fillColor: "#ef4444",
		fillOpacity: 0.9,
		strokeColor: "#991b1b",
		strokeWidth: 2,
		color: "#ef4444",
		opacity: 1,
	},
	default: {
		fillColor: "#0066CC",
		fillOpacity: 0.15,
		strokeColor: "#003399",
		strokeWidth: 1,
		color: "#003399",
		opacity: 0.9,
	},
}

export function buildMeritMapLayer(spec: MeritLayerSpec): MapLayer {
	const preset = STYLE_PRESETS[spec.style_preset || "default"] || STYLE_PRESETS.default
	const geojson =
		typeof spec.geojson === "string"
			? spec.geojson
			: JSON.stringify(spec.geojson ?? { type: "FeatureCollection", features: [] })

	const metadata: Record<string, string> = {}
	if (spec.metadata) {
		for (const [k, v] of Object.entries(spec.metadata)) {
			metadata[k] = String(v)
		}
	}
	if (!metadata.source) {
		const styleKey = spec.style_preset || "default"
		metadata.source = styleKey === "huc" ? "wbd" : styleKey === "gauge" ? "nwis" : styleKey === "dam" ? "nid" : "merit"
	}

	return MapLayer.create({
		id: spec.id,
		name: spec.name,
		layerType: spec.layer_type || "line",
		geojson,
		style: MapLayerStyle.create({
			fillColor: preset.fillColor ?? "#0066CC",
			fillOpacity: preset.fillOpacity ?? 0.2,
			strokeColor: preset.strokeColor ?? "#003399",
			strokeWidth: preset.strokeWidth ?? 2,
			color: preset.color ?? preset.strokeColor ?? "#003399",
			opacity: preset.opacity ?? 1,
			weight: preset.strokeWidth ?? 2,
		}),
		visible: true,
		metadata,
	})
}
