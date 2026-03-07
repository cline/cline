import { MergeWorktreeRequest, MergeWorktreeResult } from "@shared/proto/cline/worktree"
import { listWorktrees } from "@utils/git-worktree"
import { getWorkspacePath } from "@utils/path"
import simpleGit from "simple-git"
import { telemetryService } from "@/services/telemetry"
import { Controller } from ".."

/**
 * Merges a worktree's branch into the target branch and optionally deletes the worktree
 * @param controller The controller instance
 * @param request The merge worktree request
 * @returns MergeWorktreeResult indicating success, failure, or conflicts
 */
export async function mergeWorktree(_controller: Controller, request: MergeWorktreeRequest): Promise<MergeWorktreeResult> {
	const cwd = await getWorkspacePath()
	if (!cwd) {
		return MergeWorktreeResult.create({
			success: false,
			message: "No workspace folder found",
			hasConflicts: false,
			conflictingFiles: [],
		})
	}

	const { worktreePath, targetBranch, deleteAfterMerge } = request

	if (!worktreePath) {
		return MergeWorktreeResult.create({
			success: false,
			message: "Worktree path is required",
			hasConflicts: false,
			conflictingFiles: [],
		})
	}

	if (!targetBranch) {
		return MergeWorktreeResult.create({
			success: false,
			message: "Target branch is required",
			hasConflicts: false,
			conflictingFiles: [],
		})
	}

	try {
		// Find the worktree that has the target branch checked out
		// This is where we need to perform the merge
		const { worktrees } = await listWorktrees(cwd)
		const targetWorktree = worktrees.find((w) => w.branch === targetBranch)

		if (!targetWorktree) {
			return MergeWorktreeResult.create({
				success: false,
				message: `Target branch '${targetBranch}' is not checked out in any worktree. Please checkout the branch first.`,
				hasConflicts: false,
				conflictingFiles: [],
			})
		}

		// Use the target worktree's path for merge operations
		const targetWorktreePath = targetWorktree.path
		const git = simpleGit(targetWorktreePath)
		const worktreeGit = simpleGit(worktreePath)

		// Get the branch name of the worktree
		let sourceBranch: string
		try {
			sourceBranch = await worktreeGit.revparse(["--abbrev-ref", "HEAD"])
			sourceBranch = sourceBranch.trim()
		} catch {
			return MergeWorktreeResult.create({
				success: false,
				message: "Failed to get branch name from worktree",
				hasConflicts: false,
				conflictingFiles: [],
			})
		}

		if (sourceBranch === "HEAD") {
			return MergeWorktreeResult.create({
				success: false,
				message: "Cannot merge a detached HEAD worktree",
				hasConflicts: false,
				conflictingFiles: [],
				sourceBranch,
				targetBranch,
			})
		}

		// Check for uncommitted changes in the source worktree
		try {
			const status = await worktreeGit.status()
			if (!status.isClean()) {
				return MergeWorktreeResult.create({
					success: false,
					message: `Worktree has uncommitted changes. Please commit or stash them first.`,
					hasConflicts: false,
					conflictingFiles: [],
					sourceBranch,
					targetBranch,
				})
			}
		} catch {
			// If status check fails, continue anyway
		}

		// Check for uncommitted changes in the target worktree
		try {
			const targetStatus = await git.status()
			if (!targetStatus.isClean()) {
				return MergeWorktreeResult.create({
					success: false,
					message: `Target worktree (${targetBranch}) has uncommitted changes. Please commit or stash them first.`,
					hasConflicts: false,
					conflictingFiles: [],
					sourceBranch,
					targetBranch,
				})
			}
		} catch {
			// If status check fails, continue anyway
		}

		// Attempt the merge in the target worktree (which already has targetBranch checked out)
		try {
			await git.merge([sourceBranch, "--no-edit"])
		} catch (error) {
			// Check if it's a merge conflict
			try {
				const diffResult = await git.diff(["--name-only", "--diff-filter=U"])
				const conflictingFiles = diffResult
					.trim()
					.split("\n")
					.filter((f) => f)

				if (conflictingFiles.length > 0) {
					// Abort the merge so we don't leave the repo in a conflicted state
					try {
						await git.merge(["--abort"])
					} catch {
						// Ignore abort errors
					}

					telemetryService.captureWorktreeMergeAttempted(false, true, deleteAfterMerge)
					return MergeWorktreeResult.create({
						success: false,
						message: `Merge conflict detected. ${conflictingFiles.length} file(s) have conflicts.`,
						hasConflicts: true,
						conflictingFiles,
						sourceBranch,
						targetBranch,
					})
				}
			} catch {
				// If conflict check fails, return the original error
			}

			const errorMessage = error instanceof Error ? error.message : String(error)
			telemetryService.captureWorktreeMergeAttempted(false, false, deleteAfterMerge)
			return MergeWorktreeResult.create({
				success: false,
				message: `Merge failed: ${errorMessage}`,
				hasConflicts: false,
				conflictingFiles: [],
				sourceBranch,
				targetBranch,
			})
		}

		// Delete worktree if requested
		if (deleteAfterMerge) {
			try {
				await git.raw(["worktree", "remove", worktreePath, "--force"])
			} catch (error) {
				// Merge succeeded but deletion failed - still return success
				const errorMessage = error instanceof Error ? error.message : String(error)
				return MergeWorktreeResult.create({
					success: true,
					message: `Merged '${sourceBranch}' into '${targetBranch}' successfully, but failed to delete worktree: ${errorMessage}`,
					hasConflicts: false,
					conflictingFiles: [],
					sourceBranch,
					targetBranch,
				})
			}

			// Optionally delete the branch too
			try {
				await git.deleteLocalBranch(sourceBranch)
			} catch {
				// Branch deletion is optional, don't fail if it doesn't work
			}
		}

		telemetryService.captureWorktreeMergeAttempted(true, false, deleteAfterMerge)
		return MergeWorktreeResult.create({
			success: true,
			message: deleteAfterMerge
				? `Successfully merged '${sourceBranch}' into '${targetBranch}' and removed worktree`
				: `Successfully merged '${sourceBranch}' into '${targetBranch}'`,
			hasConflicts: false,
			conflictingFiles: [],
			sourceBranch,
			targetBranch,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return MergeWorktreeResult.create({
			success: false,
			message: `Unexpected error: ${errorMessage}`,
			hasConflicts: false,
			conflictingFiles: [],
		})
	}
}
