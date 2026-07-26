import { DeleteWorktreeRequest, WorktreeResult } from "@shared/proto/bedrock_coder/worktree"
import { deleteWorktree as deleteWorktreeUtil } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { inspectWorktreeMutation } from "@utils/worktree-safety"
import simpleGit from "simple-git"
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
		const inspection = await inspectWorktreeMutation(cwd, {
			operation: "delete",
			worktreePath: request.path,
			branch: request.deleteBranch ? request.branchName : undefined,
			allowDirty: request.allowDirty,
			affectedTaskId: request.affectedTaskId,
			affectedAgentId: request.affectedAgentId,
		})
		const operationSummary = inspection.gitOperation.join(" ")
		if (!request.approved) {
			return WorktreeResult.create({
				success: false,
				message: "Explicit approval is required before deleting a worktree",
				operationSummary,
			})
		}
		if (!inspection.allowed) {
			return WorktreeResult.create({
				success: false,
				message: inspection.reason,
				operationSummary,
			})
		}
		const result = await deleteWorktreeUtil(cwd, request.path, request.allowDirty)

		if (!result.success) {
			return WorktreeResult.create({
				success: result.success,
				message: result.message,
				operationSummary,
			})
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
					operationSummary,
				})
			}
		}

		return WorktreeResult.create({
			success: result.success,
			message: request.deleteBranch ? `${result.message} and deleted branch '${request.branchName}'` : result.message,
			operationSummary,
		})
	} catch (error) {
		Logger.error(`Error deleting worktree: ${JSON.stringify(error)}`)
		return WorktreeResult.create({
			success: false,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
