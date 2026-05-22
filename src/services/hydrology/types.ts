export interface MeritEnsureBasinResult {
	ok: boolean
	type: string
	pfaf_code?: string
	level2_ready?: boolean
	rivers_ready?: boolean
	catchments_ready?: boolean
	merit_root?: string
	message?: string
	downloaded?: string[]
	error?: string
}

export interface MeritEnsureRegionResult {
	ok: boolean
	type: string
	preset?: string
	pfaf_codes?: string[]
	rivers_ready_count?: number
	pfaf_count?: number
	merit_root?: string
	message?: string
	error?: string
}

export interface MeritLayerSpec {
	id: string
	name: string
	layer_type: string
	geojson: string | Record<string, unknown>
	style_preset?: string
	metadata?: Record<string, string>
}

export interface MeritLayersResult {
	ok: boolean
	type: string
	layers?: MeritLayerSpec[]
	message?: string
	error?: string
}

export interface DelineatePointResult {
	ok: boolean
	type: string
	data?: {
		area_km2?: number
		method_used?: string
		pfaf_code?: string
		snap_distance_m?: number
	}
	message?: string
	error?: string
}

export interface MeritPresetsResult {
	ok: boolean
	type: string
	presets?: Array<{ id: string; label: string; bbox: number[] }>
	message?: string
	error?: string
}

export interface HydroSearchHit {
	label: string
	lat: number
	lon: number
	source: "gauge" | "dam" | "coordinate" | "nominatim"
	meta?: Record<string, string>
}

export interface SearchHydrologyResult {
	ok: boolean
	type: string
	hits?: HydroSearchHit[]
	message?: string
	error?: string
}

export interface HucAtPointResult {
	ok: boolean
	type: string
	huc?: { huc_level: number; huc_code: string; huc_name: string; label: string }
	message?: string
	error?: string
}

export type HydroMapCommand =
	| "meritEnsureBasin"
	| "meritEnsureRegion"
	| "meritLayers"
	| "wbdLayers"
	| "hucAtPoint"
	| "searchHydrology"
	| "gaugesInView"
	| "delineatePoint"
	| "listPresets"
