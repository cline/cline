export interface GeeTileLayerResult {
	ok: boolean
	type: "gee_tile_layer"
	name: string
	dataset_id: string
	start_date: string
	end_date: string
	tile_url?: string
	tile_url_template?: string
	remote_tile_url_template?: string
	bounds_wgs84?: [number, number, number, number]
	provenance: Record<string, unknown>
	message?: string
	mock?: boolean
	error?: string
}

export interface GeeStatusResult {
	ok: boolean
	type: "gee_status"
	authenticated: boolean
	credentials_found?: boolean
	initialized?: boolean
	ee_available: boolean
	project_id?: string
	project_id_source?: string
	runtime?: {
		python_executable?: string
		ee_version?: string | null
		credentials_path?: string
	}
	message: string
	provenance: Record<string, unknown>
	error?: string
}

export interface GeeProjectInfo {
	project_id: string
	name?: string
	project_number?: string
	source?: string
}

export interface GeeProjectsResult {
	ok: boolean
	type: "gee_projects"
	projects: GeeProjectInfo[]
	message: string
	error?: string
	errors?: string[]
}
