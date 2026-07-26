import { CreateWorktreeRequest, WorktreeResult } from "@shared/proto/bedrock_coder/worktree"
import { createWorktree as createWorktreeUtil } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import { inspectWorktreeMutation } from "@utils/worktree-safety"
import { Logger } from "@/shared/services/Logger"
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
		const inspection = await inspectWorktreeMutation(cwd, {
			operation: "create",
			worktreePath: request.path,
			branch: request.branch,
			baseBranch: request.baseBranch,
			affectedTaskId: request.affectedTaskId,
			affectedAgentId: request.affectedAgentId,
			createNewBranch: request.createNewBranch,
		})
		const operationSummary = inspection.gitOperation.join(" ")
		if (!request.approved) {
			return WorktreeResult.create({
				success: false,
				message: "Explicit approval is required before creating a worktree",
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
		const result = await createWorktreeUtil(cwd, request.path, {
			branch: request.branch,
			baseBranch: request.baseBranch,
			createNewBranch: request.createNewBranch,
		})

		return WorktreeResult.create({
			success: result.success,
			message: result.message,
			operationSummary,
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
						isDirty: result.worktree.isDirty,
						untrackedFiles: result.worktree.untrackedFiles,
					}
				: undefined,
		})
	} catch (error) {
		Logger.error(`Error creating worktree: ${JSON.stringify(error)}`)
		return WorktreeResult.create({
			success: false,
			message: error instanceof Error ? error.message : String(error),
		})
	}
}
