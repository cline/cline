import { EmptyRequest } from "@shared/proto/cline/common"
import { BranchList } from "@shared/proto/cline/worktree"
import { getAvailableBranches as getAvailableBranchesUtil } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { Controller } from ".."

/**
 * Gets available branches for creating worktrees
 * @param controller The controller instance
 * @param request Empty request
 * @returns BranchList containing local and remote branches
 */
export async function getAvailableBranches(_controller: Controller, _request: EmptyRequest): Promise<BranchList> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return BranchList.create({
			localBranches: [],
			remoteBranches: [],
			currentBranch: "",
		})
	}

	try {
		const result = await getAvailableBranchesUtil(cwd)

		return BranchList.create({
			localBranches: result.localBranches,
			remoteBranches: result.remoteBranches,
			currentBranch: result.currentBranch,
		})
	} catch (error) {
		console.error(`Error getting available branches: ${JSON.stringify(error)}`)
		return BranchList.create({
			localBranches: [],
			remoteBranches: [],
			currentBranch: "",
		})
	}
}
