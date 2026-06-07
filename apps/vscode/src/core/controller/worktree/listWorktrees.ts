import { EmptyRequest } from "@shared/proto/cline/common"
import { WorktreeList } from "@shared/proto/cline/worktree"
import { getGitRootPath, listWorktrees as listWorktreesUtil } from "@utils/git-worktree"
import { arePathsEqual, getWorkspacePath } from "@utils/path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Lists all git worktrees in the current repository
 * @param controller The controller instance
 * @param request Empty request
 * @returns WorktreeList containing all worktrees
 */
export async function listWorktrees(_controller: Controller, _request: EmptyRequest): Promise<WorktreeList> {
	// Check for multi-root workspace
	const workspacePaths = (await HostProvider.workspace.getWorkspacePaths({})).paths
	const isMultiRoot = workspacePaths.length > 1

	if (isMultiRoot) {
		return WorktreeList.create({
			worktrees: [],
			isGitRepo: false,
			isMultiRoot: true,
			isSubfolder: false,
			gitRootPath: "",
			error: "",
		})
	}

	const cwd = await getWorkspacePath()
	if (!cwd) {
		return WorktreeList.create({
			worktrees: [],
			isGitRepo: false,
			isMultiRoot: false,
			isSubfolder: false,
			gitRootPath: "",
			error: "No workspace folder open",
		})
	}

	// Check if workspace is a subfolder of a git repo (not at repo root)
	const gitRootPath = await getGitRootPath(cwd)
	const isSubfolder = gitRootPath !== null && !arePathsEqual(cwd, gitRootPath)

	if (isSubfolder) {
		return WorktreeList.create({
			worktrees: [],
			isGitRepo: true,
			isMultiRoot: false,
			isSubfolder: true,
			gitRootPath: gitRootPath || "",
			error: "",
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
			isMultiRoot: false,
			isSubfolder: false,
			gitRootPath: gitRootPath || "",
			error: result.error || "",
		})
	} catch (error) {
		Logger.error(`Error listing worktrees: ${JSON.stringify(error)}`)
		return WorktreeList.create({
			worktrees: [],
			isGitRepo: false,
			isMultiRoot: false,
			isSubfolder: false,
			gitRootPath: "",
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
