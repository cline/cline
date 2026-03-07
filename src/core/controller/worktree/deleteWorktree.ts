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

		// Clean up checkpoint data (shadow git repo) for the deleted worktree
		try {
			const cwdHash = hashWorkingDir(request.path)
			const checkpointDir = path.join(HostProvider.get().globalStorageFsPath, "checkpoints", cwdHash)
			await rm(checkpointDir, { recursive: true, force: true })
		} catch (error) {
			// Log but don't fail - checkpoint cleanup is best-effort
			Logger.log(`Failed to cleanup checkpoints for deleted worktree: ${error}`)
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
