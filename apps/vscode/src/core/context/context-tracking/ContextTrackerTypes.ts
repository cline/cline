// Type definitions for FileContextTracker
export interface FileMetadataEntry {
	path: string
	record_state: "active" | "stale"
	record_source: "read_tool" | "user_edited" | "cline_edited" | "file_mentioned"
	cline_read_date: number | null
	cline_edit_date: number | null
	user_edit_date?: number | null
}

export interface ModelMetadataEntry {
	ts: number
	model_id: string
	model_provider_id: string
	mode: string
}

export interface EnvironmentMetadataEntry {
	ts: number
	os_name: string
	os_version: string
	os_arch: string
	host_name: string
	host_version: string
	cline_version: string
}

export interface TaskMetadata {
	files_in_context: FileMetadataEntry[]
	model_usage: ModelMetadataEntry[]
	environment_history: EnvironmentMetadataEntry[]
}
