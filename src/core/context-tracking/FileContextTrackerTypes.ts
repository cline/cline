import * as vscode from "vscode"

// Type definitions for FileContextTracker
export interface FileMetadataEntry {
	path: string
	record_state: "active" | "stale"
	record_source: "read_tool" | "user_edited" | "cline_edited" | "file_mentioned"
	cline_read_date: number | null
	cline_edit_date: number | null
	user_edit_date?: number | null
}

export interface TaskMetadata {
	files_in_context: FileMetadataEntry[]
}

// Interface for the controller to avoid direct dependency
export interface ControllerLike {
	context: vscode.ExtensionContext
}
