import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"

export interface MapLayerStylePatch {
	fillColor?: string
	fillOpacity?: number
	strokeColor?: string
	color?: string
	strokeWidth?: number
	weight?: number
	opacity?: number
}

export interface MapLayerPatch {
	style?: MapLayerStylePatch
	metadata?: Record<string, string>
	visible?: boolean
	name?: string
	/** When true, remove graduated_* metadata keys (switch to basic symbology). */
	clear_graduated?: boolean
}

const GRADUATED_KEYS = ["graduated_attr", "graduated_method", "graduated_breaks", "graduated_colors", "graduated_ramp"]

/**
 * Merge a style/metadata patch onto an existing map layer without changing geojson.
 */
export function mergeMapLayerPatch(layer: MapLayer, patch: MapLayerPatch): MapLayer {
	const nextMeta: Record<string, string> = { ...(layer.metadata ?? {}) }

	if (patch.clear_graduated) {
		for (const key of GRADUATED_KEYS) {
			delete nextMeta[key]
		}
	}
	if (patch.metadata) {
		for (const [k, v] of Object.entries(patch.metadata)) {
			if (v === "" || v === undefined) {
				delete nextMeta[k]
			} else {
				nextMeta[k] = v
			}
		}
	}
	if (patch.metadata?.display_name) {
		nextMeta.display_name = patch.metadata.display_name
	}

	let nextStyle = layer.style ? MapLayerStyle.create({ ...layer.style }) : MapLayerStyle.create({})
	if (patch.style) {
		const s = patch.style
		nextStyle = MapLayerStyle.create({
			fillColor: s.fillColor ?? nextStyle.fillColor,
			fillOpacity: s.fillOpacity ?? nextStyle.fillOpacity,
			strokeColor: s.strokeColor ?? nextStyle.strokeColor,
			color: s.color ?? s.strokeColor ?? nextStyle.color,
			strokeWidth: s.strokeWidth ?? nextStyle.strokeWidth,
			weight: s.weight ?? s.strokeWidth ?? nextStyle.weight,
			opacity: s.opacity ?? nextStyle.opacity,
		})
	}

	return MapLayer.create({
		...layer,
		name: patch.name ?? layer.name,
		style: nextStyle,
		metadata: nextMeta,
		visible: patch.visible !== undefined ? patch.visible : layer.visible,
	})
}
