import type { MapLayer } from "@shared/proto/cline/map"

/** WGS84 bounding box: [west, south, east, north] */
export type LayerBounds = [number, number, number, number]

export type LegendSpec =
	| {
			type: "continuous"
			title?: string
			units?: string
			min?: number
			max?: number
			colormap?: string
			stops?: Array<[number, string]>
	  }
	| {
			type: "categorical"
			title?: string
			classes: Array<{ value: string | number; label: string; color: string }>
	  }

/**
 * View model aligned with the planned backend LiveLayer contract.
 * Built from wire-format MapLayer + metadata conventions (no proto change in slice 1).
 */
export interface LiveLayer {
	id: string
	name: string
	layerType: string
	visible: boolean
	opacity: number
	bounds?: LayerBounds
	legend?: LegendSpec
	provenancePath?: string
	source?: string
	geeDatasetId?: string
	geeStartDate?: string
	geeEndDate?: string
	geeMock?: boolean
}

export function parseBoundsJson(raw?: string): LayerBounds | undefined {
	if (!raw) {
		return undefined
	}
	try {
		const b = JSON.parse(raw) as number[]
		if (b.length === 4 && b.every((v) => Number.isFinite(v))) {
			return [b[0], b[1], b[2], b[3]]
		}
	} catch {
		/* ignore */
	}
	return undefined
}

export function mapLayerToLiveLayer(layer: MapLayer): LiveLayer {
	const meta = layer.metadata ?? {}
	const bounds = parseBoundsJson(meta.gee_bounds) ?? parseBoundsJson(meta.raster_bounds)

	let opacity = layer.style?.opacity ?? 1
	if (meta.raster_opacity) {
		const parsed = parseFloat(meta.raster_opacity)
		if (Number.isFinite(parsed)) {
			opacity = parsed
		}
	}

	let legend: LegendSpec | undefined
	if (meta.legend) {
		try {
			legend = JSON.parse(meta.legend) as LegendSpec
		} catch {
			legend = undefined
		}
	}

	return {
		id: layer.id,
		name: layer.name,
		layerType: layer.layerType,
		visible: layer.visible,
		opacity,
		bounds,
		legend,
		provenancePath: meta.provenance_path,
		source: meta.source,
		geeDatasetId: meta.gee_dataset_id,
		geeStartDate: meta.gee_start_date,
		geeEndDate: meta.gee_end_date,
		geeMock: meta.gee_mock === "true",
	}
}
