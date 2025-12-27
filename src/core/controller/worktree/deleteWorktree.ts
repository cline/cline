import { DeleteWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { deleteWorktree as deleteWorktreeUtil } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."

/**
 * Deletes an existing git worktree
 * @param controller The controller instance
 * @param request The request containing path and force flag
 * @returns WorktreeResult with success status
 */
export async function deleteWorktree(_controller: Controller, request: DeleteWorktreeRequest): Promise<WorktreeResult> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeResult.create({
			success: false,
			message: "No workspace folder open",
		})
	}

	try {
		const result = await deleteWorktreeUtil(cwd, request.path, request.force)

		return WorktreeResult.create({
			success: result.success,
			message: result.message,
		})
	} catch (error) {
		console.error(`Error deleting worktree: ${JSON.stringify(error)}`)
		return WorktreeResult.create({
			success: false,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
