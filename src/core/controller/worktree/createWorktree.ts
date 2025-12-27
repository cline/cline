import { CreateWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { createWorktree as createWorktreeUtil } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."

/**
 * Creates a new git worktree
 * @param controller The controller instance
 * @param request The request containing path and branch information
 * @returns WorktreeResult with success status and created worktree info
 */
export async function createWorktree(_controller: Controller, request: CreateWorktreeRequest): Promise<WorktreeResult> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeResult.create({
			success: false,
			message: "No workspace folder open",
		})
	}

	try {
		const result = await createWorktreeUtil(cwd, request.path, {
			branch: request.branch,
			baseBranch: request.baseBranch,
			createNewBranch: request.createNewBranch,
		})

		return WorktreeResult.create({
			success: result.success,
			message: result.message,
			worktree: result.worktree
				? {
						path: result.worktree.path,
						branch: result.worktree.branch,
						commitHash: result.worktree.commitHash,
						isCurrent: result.worktree.isCurrent,
						isBare: result.worktree.isBare,
						isDetached: result.worktree.isDetached,
						isLocked: result.worktree.isLocked,
						lockReason: result.worktree.lockReason,
					}
				: undefined,
		})
	} catch (error) {
		console.error(`Error creating worktree: ${JSON.stringify(error)}`)
		return WorktreeResult.create({
			success: false,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
