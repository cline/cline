/**
 * BeadCommitService - Handles git commits for approved beads.
 *
 * Supports two commit modes:
 * - shadow: Commits to a hidden branch (like checkpoints), non-destructive
 * - workspace: Commits directly to the current working branch
 */

import type { Bead } from "@shared/beads"

import { Logger } from "@shared/services/Logger"
import simpleGit, { type SimpleGit } from "simple-git"

/**
 * Options for creating a bead commit.
 */
export interface BeadCommitOptions {
	/** The mode for committing: shadow (hidden branch) or workspace (current branch) */
	mode: "shadow" | "workspace"
	/** Optional custom commit message prefix */
	messagePrefix?: string
}

/**
 * Result of a bead commit operation.
 */
export interface BeadCommitResult {
	/** Whether the commit was successful */
	success: boolean
	/** The commit hash if successful */
	commitHash?: string
	/** Error message if failed */
	error?: string
	/** The branch the commit was made to */
	branch?: string
}

/**
 * Service for handling git commits when beads are approved.
 */
export class BeadCommitService {
	private workspaceRoot: string
	private shadowBranchName: string

	constructor(workspaceRoot: string, taskId?: string) {
		this.workspaceRoot = workspaceRoot
		this.shadowBranchName = taskId ? `beadsmith/beads/${taskId}` : "beadsmith/beads/default"
	}

	/**
	 * Commit the changes from an approved bead.
	 *
	 * @param bead The bead to commit
	 * @param options Commit options including mode
	 * @returns The result of the commit operation
	 */
	async commitBead(bead: Bead, options: BeadCommitOptions): Promise<BeadCommitResult> {
		const { mode, messagePrefix = "[Bead" } = options

		try {
			if (mode === "shadow") {
				return await this.commitToShadowBranch(bead, messagePrefix)
			} else {
				return await this.commitToWorkspace(bead, messagePrefix)
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error(`[BeadCommitService] Failed to commit bead ${bead.beadNumber}:`, error)
			return {
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Commit to a shadow branch (non-destructive, preserves working branch).
	 */
	private async commitToShadowBranch(bead: Bead, messagePrefix: string): Promise<BeadCommitResult> {
		const git = simpleGit(this.workspaceRoot)

		// Check if we're in a git repository
		const isRepo = await git.checkIsRepo()
		if (!isRepo) {
			return {
				success: false,
				error: "Not a git repository",
			}
		}

		// Get the current branch to return to later
		const currentBranch = await this.getCurrentBranch(git)

		// Stash any uncommitted changes in the working directory
		const status = await git.status()
		const hasChanges = !status.isClean()

		if (hasChanges) {
			await git.stash(["push", "-m", `beadsmith-temp-stash-bead-${bead.beadNumber}`])
		}

		try {
			// Create or checkout the shadow branch
			const branchExists = await this.branchExists(git, this.shadowBranchName)
			if (branchExists) {
				await git.checkout(this.shadowBranchName)
			} else {
				await git.checkoutLocalBranch(this.shadowBranchName)
			}

			// Stage the files that were changed in this bead
			const filesToStage = bead.filesChanged.map((f) => f.filePath)
			if (filesToStage.length > 0) {
				await git.add(filesToStage)
			}

			// Create the commit
			const commitMessage = this.buildCommitMessage(bead, messagePrefix)
			const result = await git.commit(commitMessage, {
				"--allow-empty": null,
				"--no-verify": null,
			})

			const commitHash = (result.commit || "").replace(/^HEAD\s+/, "")

			// Return to the original branch
			if (currentBranch) {
				await git.checkout(currentBranch)
			}

			// Restore stashed changes if any
			if (hasChanges) {
				await git.stash(["pop"])
			}

			Logger.info(`[BeadCommitService] Shadow commit created: ${commitHash} on branch ${this.shadowBranchName}`)

			return {
				success: true,
				commitHash,
				branch: this.shadowBranchName,
			}
		} catch (error) {
			// Attempt to recover: return to original branch and restore stash
			try {
				if (currentBranch) {
					await git.checkout(currentBranch)
				}
				if (hasChanges) {
					await git.stash(["pop"])
				}
			} catch (recoveryError) {
				Logger.error("[BeadCommitService] Failed to recover from shadow commit error:", recoveryError)
			}
			throw error
		}
	}

	/**
	 * Commit directly to the current workspace branch.
	 */
	private async commitToWorkspace(bead: Bead, messagePrefix: string): Promise<BeadCommitResult> {
		const git = simpleGit(this.workspaceRoot)

		// Check if we're in a git repository
		const isRepo = await git.checkIsRepo()
		if (!isRepo) {
			return {
				success: false,
				error: "Not a git repository",
			}
		}

		// Stage the files that were changed in this bead
		const filesToStage = bead.filesChanged.map((f) => f.filePath)
		if (filesToStage.length > 0) {
			await git.add(filesToStage)
		}

		// Create the commit
		const commitMessage = this.buildCommitMessage(bead, messagePrefix)
		const result = await git.commit(commitMessage, {
			"--allow-empty": null,
			"--no-verify": null,
		})

		const commitHash = (result.commit || "").replace(/^HEAD\s+/, "")
		const currentBranch = await this.getCurrentBranch(git)

		Logger.info(`[BeadCommitService] Workspace commit created: ${commitHash} on branch ${currentBranch}`)

		return {
			success: true,
			commitHash,
			branch: currentBranch || undefined,
		}
	}

	/**
	 * Build a commit message for a bead.
	 */
	private buildCommitMessage(bead: Bead, messagePrefix: string): string {
		const filesChanged = bead.filesChanged.length
		const summary = bead.response ? bead.response.slice(0, 50).replace(/\n/g, " ") : "No response"

		return `${messagePrefix} ${bead.beadNumber}] ${summary}${summary.length >= 50 ? "..." : ""}

Files changed: ${filesChanged}
Bead ID: ${bead.id}
Task ID: ${bead.taskId}
`
	}

	/**
	 * Get the current branch name.
	 */
	private async getCurrentBranch(git: SimpleGit): Promise<string | null> {
		try {
			const branchSummary = await git.branch()
			return branchSummary.current || null
		} catch {
			return null
		}
	}

	/**
	 * Check if a branch exists.
	 */
	private async branchExists(git: SimpleGit, branchName: string): Promise<boolean> {
		try {
			const branches = await git.branch()
			return branches.all.includes(branchName)
		} catch {
			return false
		}
	}

	/**
	 * Get the list of commits on the shadow branch for this task.
	 */
	async getBeadCommits(): Promise<Array<{ hash: string; message: string; date: string }>> {
		const git = simpleGit(this.workspaceRoot)

		try {
			const branchExists = await this.branchExists(git, this.shadowBranchName)
			if (!branchExists) {
				return []
			}

			const log = await git.log({ [this.shadowBranchName]: null })
			return log.all.map((commit) => ({
				hash: commit.hash,
				message: commit.message,
				date: commit.date,
			}))
		} catch (error) {
			Logger.error("[BeadCommitService] Failed to get bead commits:", error)
			return []
		}
	}

	/**
	 * Clean up the shadow branch when the task is complete.
	 * Optional - call this to remove the shadow branch after task completion.
	 */
	async cleanupShadowBranch(): Promise<void> {
		const git = simpleGit(this.workspaceRoot)

		try {
			const branchExists = await this.branchExists(git, this.shadowBranchName)
			if (branchExists) {
				// Make sure we're not on the shadow branch before deleting
				const currentBranch = await this.getCurrentBranch(git)
				if (currentBranch === this.shadowBranchName) {
					// Switch to main/master first
					const branches = await git.branch()
					const defaultBranch = branches.all.find((b) => b === "main" || b === "master") || branches.all[0]
					if (defaultBranch && defaultBranch !== this.shadowBranchName) {
						await git.checkout(defaultBranch)
					}
				}

				await git.deleteLocalBranch(this.shadowBranchName, true)
				Logger.info(`[BeadCommitService] Cleaned up shadow branch: ${this.shadowBranchName}`)
			}
		} catch (error) {
			Logger.error("[BeadCommitService] Failed to cleanup shadow branch:", error)
		}
	}
}

/**
 * Create a BeadCommitService instance.
 */
export function createBeadCommitService(workspaceRoot: string, taskId?: string): BeadCommitService {
	return new BeadCommitService(workspaceRoot, taskId)
}
