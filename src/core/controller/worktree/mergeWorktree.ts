import { MergeWorktreeRequest, MergeWorktreeResult } from "@shared/proto/cline/worktree"
import { getWorkspacePath } from "@utils/path"
import simpleGit from "simple-git"
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
		const git = simpleGit(cwd)
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

		// Check for uncommitted changes in the worktree
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

		// Checkout target branch in the main worktree
		try {
			await git.checkout(targetBranch)
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			return MergeWorktreeResult.create({
				success: false,
				message: `Failed to checkout target branch '${targetBranch}': ${errorMessage}`,
				hasConflicts: false,
				conflictingFiles: [],
				sourceBranch,
				targetBranch,
			})
		}

		// Attempt the merge
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
