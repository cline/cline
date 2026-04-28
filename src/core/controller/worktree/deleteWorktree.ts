import { DeleteWorktreeRequest, WorktreeResult } from "@shared/proto/cline/worktree"
import { deleteWorktree as deleteWorktreeUtil } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { rm } from "fs/promises"
import path from "path"
import simpleGit from "simple-git"
import { HostProvider } from "@/hosts/host-provider"
import { hashWorkingDir } from "@/integrations/checkpoints/CheckpointUtils"
import { Logger } from "@/shared/services/Logger"
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

		if (!result.success) {
			return WorktreeResult.create({
				success: result.success,
				message: result.message,
			})
		}

		// Clean up checkpoint data for the deleted worktree:
		// 1. Legacy shadow git cleanup (for tasks created before ref-based checkpoints)
		try {
			const cwdHash = hashWorkingDir(request.path)
			const checkpointDir = path.join(HostProvider.get().globalStorageFsPath, "checkpoints", cwdHash)
			await rm(checkpointDir, { recursive: true, force: true })
		} catch (error) {
			Logger.log(`Failed to cleanup legacy checkpoints for deleted worktree: ${error}`)
		}

		// 2. Ref-based checkpoint cleanup (delete refs/cline/checkpoints/* in the worktree's repo)
		try {
			const { RefCheckpointTracker } = await import("@/integrations/checkpoints/RefCheckpointTracker")
			// Get all task IDs that had checkpoints in this worktree
			const git = simpleGit(cwd)
			const refs = await git.raw(["for-each-ref", "--format=%(refname)", "refs/cline/checkpoints/"])
			for (const ref of refs.split("\n").filter(Boolean)) {
				await git.raw(["update-ref", "-d", ref]).catch(() => {})
			}
		} catch (error) {
			Logger.log(`Failed to cleanup ref-based checkpoints for deleted worktree: ${error}`)
		}

		// Delete the branch if requested
		if (request.deleteBranch && request.branchName) {
			try {
				const git = simpleGit(cwd)
				await git.deleteLocalBranch(request.branchName)
			} catch {
				// Branch deletion failed, but worktree was deleted successfully
				return WorktreeResult.create({
					success: true,
					message: `${result.message}, but failed to delete branch '${request.branchName}'`,
				})
			}
		}

		return WorktreeResult.create({
			success: result.success,
			message: request.deleteBranch ? `${result.message} and deleted branch '${request.branchName}'` : result.message,
		})
	} catch (error) {
		Logger.error(`Error deleting worktree: ${JSON.stringify(error)}`)
		return WorktreeResult.create({
			success: false,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
