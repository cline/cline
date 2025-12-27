import { EmptyRequest } from "@shared/proto/cline/common"
import { WorktreeList } from "@shared/proto/cline/worktree"
import { listWorktrees as listWorktreesUtil } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."

/**
 * Lists all git worktrees in the current repository
 * @param controller The controller instance
 * @param request Empty request
 * @returns WorktreeList containing all worktrees
 */
export async function listWorktrees(_controller: Controller, _request: EmptyRequest): Promise<WorktreeList> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeList.create({
			worktrees: [],
			isGitRepo: false,
			error: "No workspace folder open",
		})
	}

	try {
		const result = await listWorktreesUtil(cwd)

		return WorktreeList.create({
			worktrees: result.worktrees.map((wt) => ({
				path: wt.path,
				branch: wt.branch,
				commitHash: wt.commitHash,
				isCurrent: wt.isCurrent,
				isBare: wt.isBare,
				isDetached: wt.isDetached,
				isLocked: wt.isLocked,
				lockReason: wt.lockReason,
			})),
			isGitRepo: result.isGitRepo,
			error: result.error || "",
		})
	} catch (error) {
		console.error(`Error listing worktrees: ${JSON.stringify(error)}`)
		return WorktreeList.create({
			worktrees: [],
			isGitRepo: false,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
