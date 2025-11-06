/**
 * Apply Patch constants
 */
export const PATCH_MARKERS = {
	BEGIN: "*** Begin Patch",
	END: "*** End Patch",
	ADD: "*** Add File: ",
	UPDATE: "*** Update File: ",
	DELETE: "*** Delete File: ",
	MOVE: "*** Move to: ",
	SECTION: "@@",
	END_FILE: "*** End of File",
} as const

/**
 * Expected bash wrappers for apply patch content
 */
export const BASH_WRAPPERS = ["%%bash", "apply_patch", "EOF", "```"] as const

/**
 * Domains of patch actions
 */
export enum PatchActionType {
	ADD = "add",
	DELETE = "delete", // TODO: Implement delete action in diff editor.
	UPDATE = "update",
}

export interface PatchChunk {
	origIndex: number // line index in original file where change starts
	delLines: string[] // Lines to delete (without the "-" prefix)
	insLines: string[] // Lines to insert (without the "+" prefix)
}

export interface PatchAction {
	type: PatchActionType
	newFile?: string
	chunks: PatchChunk[]
	movePath?: string
}

/**
 * Warning information for skipped/problematic chunks
 */
export interface PatchWarning {
	path: string
	chunkIndex?: number
	message: string
	context?: string
}

/**
 * Apply Patch structure
 */
export interface Patch {
	actions: Record<string, PatchAction>
	warnings?: PatchWarning[]
}

export class DiffError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "DiffError"
	}
}
