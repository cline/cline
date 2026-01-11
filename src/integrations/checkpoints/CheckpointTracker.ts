import { sendCheckpointEvent } from "@core/controller/checkpoints/subscribeToCheckpoints"
import fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import * as path from "path"
import simpleGit from "simple-git"
import type { FolderLockWithRetryResult } from "@/core/locks/types"
import { telemetryService } from "@/services/telemetry"
import { GitOperations } from "./CheckpointGitOperations"
import { releaseCheckpointLock, tryAcquireCheckpointLockWithRetry } from "./CheckpointLockUtils"
import { getShadowGitPath, hashWorkingDir } from "./CheckpointUtils"

/**
 * Operation types for checkpoint events
 */
type CheckpointOperation = "CHECKPOINT_INIT" | "CHECKPOINT_COMMIT" | "CHECKPOINT_RESTORE"

/**
 * CheckpointTracker Module
 *
 * Core implementation of Cline's Checkpoints system that provides version control
 * capabilities without interfering with the user's main Git repository. Key features:
 *
 * Shadow Git Repository:
 * - Creates and manages an isolated Git repository for tracking checkpoints
 * - Handles nested Git repositories by temporarily disabling them
 * - Configures Git settings automatically (identity, LFS, etc.)
 *
 * File Management:
 * - Integrates with CheckpointExclusions for file filtering
 * - Handles workspace validation and path resolution
 * - Manages Git worktree configuration
 *
 * Checkpoint Operations:
 * - Creates checkpoints (commits) of the current state
 * - Provides diff capabilities between checkpoints
 * - Supports resetting to previous checkpoints
 *
 * Safety Features:
 * - Prevents usage in sensitive directories (home, desktop, etc.)
 * - Validates workspace configuration
 * - Handles cleanup and resource disposal
 *
 * Checkpoint Architecture:
 * - Unique shadow git repository for each workspace
 * - Workspaces are identified by name, and hashed to a unique number
 * - All commits for a workspace are stored in one shadow git, under a single branch
 */

class CheckpointTracker {
	private taskId: string
	private cwd: string
	private cwdHash: string
	private lastRetrievedShadowGitConfigWorkTree?: string
	private gitOperations: GitOperations

	/**
	 * Helper method to clean commit hashes that might have a "HEAD " prefix.
	 * Used for backward compatibility with old tasks that stored hashes with the prefix.
	 */
	private cleanCommitHash(hash: string): string {
		return hash.startsWith("HEAD ") ? hash.slice(5) : hash
	}

	/**
	 * Send a checkpoint event to all subscribers.
	 *
	 * @param operation - The operation type (CHECKPOINT_INIT, CHECKPOINT_COMMIT, or CHECKPOINT_RESTORE)
	 * @param isActive - true when operation starts, false when complete
	 * @param commitHash - Optional commit hash for CHECKPOINT_COMMIT and CHECKPOINT_RESTORE operations
	 */
	private async sendCheckpointSubscriptionEvent(
		operation: CheckpointOperation,
		isActive: boolean,
		commitHash?: string,
	): Promise<void> {
		try {
			await sendCheckpointEvent({
				operation,
				cwdHash: this.cwdHash,
				isActive,
				taskId: this.taskId,
				commitHash,
			})
		} catch (error) {
			console.debug("Failed to send checkpoint event:", error)
		}
	}

	/**
	 * Creates a new CheckpointTracker instance to manage checkpoints for a specific task.
	 * The constructor is private - use the static create() method to instantiate.
	 *
	 * @param taskId - Unique identifier for the task being tracked
	 * @param cwd - The current working directory to track files in
	 * @param cwdHash - Hash of the working directory path for shadow git organization
	 */
	private constructor(taskId: string, cwd: string, cwdHash: string) {
		this.taskId = taskId
		this.cwd = cwd
		this.cwdHash = cwdHash
		this.gitOperations = new GitOperations(cwd)
	}

	/**
	 * Creates a new CheckpointTracker instance for tracking changes in a task.
	 * Handles initialization of the shadow git repository.
	 *
	 * @param taskId - Unique identifier for the task to track
	 * @param globalStoragePath - the globalStorage path
	 * @param enableCheckpointsSetting - Whether checkpoints are enabled in settings
	 * @param workspacePaths - The workspace directory path(s) to track (string or array of strings)
	 * @returns Promise resolving to new CheckpointTracker instance, or undefined if checkpoints are disabled
	 * @throws Error if:
	 * - globalStoragePath is not supplied
	 * - Git is not installed
	 * - Working directory is invalid or in a protected location
	 * - Shadow git initialization fails
	 *
	 * Key operations:
	 * - Validates git installation and settings
	 * - Creates/initializes shadow git repository
	 *
	 * Configuration:
	 * - Respects 'cline.enableCheckpoints' VS Code setting
	 */
	public static async create(
		taskId: string,
		enableCheckpointsSetting: boolean,
		workspacePaths: string | string[],
	): Promise<CheckpointTracker | undefined> {
		try {
			console.info(`Creating new CheckpointTracker for task ${taskId}`)
			const startTime = performance.now()

			// Check if checkpoints are disabled by setting
			if (!enableCheckpointsSetting) {
				console.info(`Checkpoints disabled by setting for task ${taskId}`)
				return undefined // Don't create tracker when disabled
			}

			// Check if git is installed by attempting to get version
			try {
				await simpleGit().version()
			} catch (_error) {
				throw new Error("Git must be installed to use checkpoints.") // FIXME: must match what we check for in TaskHeader to show link
			}

			// Validate and normalize workspace paths - for now, we just use the first valid path
			const pathsToValidate = Array.isArray(workspacePaths) ? workspacePaths : [workspacePaths]
			const { validateWorkspacePath } = await import("./CheckpointUtils")

			for (const workspacePath of pathsToValidate) {
				if (!workspacePath) {
					throw new Error("At least one workspace path must be provided")
				}

				await validateWorkspacePath(workspacePath)
			}

			// For now, we just use the first valid path
			const workingDir = Array.isArray(workspacePaths) ? workspacePaths[0] : workspacePaths

			const cwdHash = hashWorkingDir(workingDir)
			console.debug(`Repository ID (cwdHash): ${cwdHash}`)

			const newTracker = new CheckpointTracker(taskId, workingDir, cwdHash)
			await newTracker.sendCheckpointSubscriptionEvent("CHECKPOINT_INIT", true)

			const gitPath = await getShadowGitPath(newTracker.cwdHash)
			await newTracker.gitOperations.initShadowGit(gitPath, workingDir, taskId)
			await newTracker.sendCheckpointSubscriptionEvent("CHECKPOINT_INIT", false)

			const durationMs = Math.round(performance.now() - startTime)
			telemetryService.captureCheckpointUsage(taskId, "shadow_git_initialized", durationMs)

			return newTracker
		} catch (error) {
			console.error("Failed to create CheckpointTracker:", error)
			throw error
		}
	}

	/**
	 * Creates a new checkpoint commit in the shadow git repository.
	 *
	 * Key behaviors:
	 * - Acquires folder lock before proceeding to prevent conflicts
	 * - Creates commit with checkpoint files in shadow git repo
	 * - Releases folder lock after completion
	 * - Caches the created commit hash
	 *
	 * Commit structure:
	 * - Commit message: "checkpoint-{cwdHash}-{taskId}"
	 * - Always allows empty commits
	 *
	 * Dependencies:
	 * - Requires initialized shadow git (getShadowGitPath)
	 * - Uses addCheckpointFiles to stage changes using 'git add .'
	 * - Relies on git's native exclusion handling via the exclude file
	 *
	 * @returns Promise<string | undefined> The created commit hash, or undefined if:
	 * - Folder lock acquisition fails or times out
	 * - Shadow git access fails
	 * - Staging files fails
	 * - Commit creation fails
	 * @throws Error if unable to:
	 * - Access shadow git path
	 * - Initialize simple-git
	 * - Stage or commit files
	 */
	public async commit(): Promise<string | undefined> {
		let lockAcquired: boolean = false

		try {
			await this.sendCheckpointSubscriptionEvent("CHECKPOINT_COMMIT", true)
			console.info(`Creating new checkpoint commit for task ${this.taskId}`)
			const startTime = performance.now()

			const lockResult: FolderLockWithRetryResult = await tryAcquireCheckpointLockWithRetry(this.cwdHash, this.taskId)

			// Locking failed due to conflicting lock
			if (!lockResult.acquired && !lockResult.skipped) {
				throw new Error(
					"Failed to acquire checkpoint folder lock - another Cline instance may be performing checkpoint operations",
				)
			}

			// Locking skipped as we are in VS Code
			if (!lockResult.acquired && lockResult.skipped) {
				console.log("Skipping Checkpoints lock - VS Code")
			}

			if (lockResult.acquired) {
				lockAcquired = true
			}

			const gitPath = await getShadowGitPath(this.cwdHash)
			const git = simpleGit(path.dirname(gitPath))

			console.info(`Using shadow git at: ${gitPath}`)

			const addFilesResult = await this.gitOperations.addCheckpointFiles(git)
			if (!addFilesResult.success) {
				console.error("Failed to add at least one file(s) to checkpoints shadow git")
			}

			const commitMessage = "checkpoint-" + this.cwdHash + "-" + this.taskId

			console.info(`Creating checkpoint commit with message: ${commitMessage}`)
			const result = await git.commit(commitMessage, {
				"--allow-empty": null,
				"--no-verify": null,
			})
			const commitHash = (result.commit || "").replace(/^HEAD\s+/, "")
			console.warn(`Checkpoint commit created: `, commitHash)

			const durationMs = Math.round(performance.now() - startTime)
			await this.sendCheckpointSubscriptionEvent("CHECKPOINT_COMMIT", false, commitHash)
			telemetryService.captureCheckpointUsage(this.taskId, "commit_created", durationMs)

			return commitHash
		} catch (error) {
			console.error("Failed to create checkpoint:", {
				taskId: this.taskId,
				error,
			})
			throw new Error(`Failed to create checkpoint: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			if (lockAcquired) {
				console.info("Releasing checkpoint folder lock")
				await releaseCheckpointLock(this.cwdHash, this.taskId)
			}
		}
	}

	/**
	 * Retrieves the worktree path from the shadow git configuration.
	 * The worktree path indicates where the shadow git repository is tracking files,
	 * which should match the current workspace directory.
	 *
	 * Key behaviors:
	 * - Caches result in lastRetrievedShadowGitConfigWorkTree to avoid repeated reads
	 * - Returns cached value if available
	 * - Reads git config if no cached value exists
	 *
	 * Configuration read:
	 * - Uses simple-git to read core.worktree config
	 * - Operates on shadow git at path from getShadowGitPath()
	 *
	 * @returns Promise<string | undefined> The configured worktree path, or undefined if:
	 * - Shadow git repository doesn't exist
	 * - Config read fails
	 * - No worktree is configured
	 * @throws Error if unable to:
	 * - Access shadow git path
	 * - Initialize simple-git
	 * - Read git configuration
	 */
	public async getShadowGitConfigWorkTree(): Promise<string | undefined> {
		if (this.lastRetrievedShadowGitConfigWorkTree) {
			return this.lastRetrievedShadowGitConfigWorkTree
		}
		try {
			const gitPath = await getShadowGitPath(this.cwdHash)
			this.lastRetrievedShadowGitConfigWorkTree = await this.gitOperations.getShadowGitConfigWorkTree(gitPath)
			return this.lastRetrievedShadowGitConfigWorkTree
		} catch (error) {
			console.error("Failed to get shadow git config worktree:", error)
			return undefined
		}
	}

	/**
	 * Resets the shadow git repository's HEAD to a specific checkpoint commit.
	 * This will discard all changes after the target commit and restore the
	 * working directory to that checkpoint's state.
	 *
	 * Key behaviors:
	 * - Acquires folder lock before proceeding to prevent conflicts
	 * - Performs hard reset to target commit
	 * - Releases folder lock after completion
	 *
	 * Dependencies:
	 * - Requires initialized shadow git (getShadowGitPath)
	 * - Must be called with a valid commit hash from this task's history
	 *
	 * @param commitHash - The hash of the checkpoint commit to reset to
	 * @returns Promise<void> Resolves when reset is complete
	 * @throws Error if unable to:
	 * - Acquire folder lock (timeout or conflict)
	 * - Access shadow git path
	 * - Initialize simple-git
	 * - Reset to target commit
	 */
	public async resetHead(commitHash: string): Promise<void> {
		let lockAcquired: boolean = false

		try {
			console.info(`Resetting to checkpoint: ${commitHash}`)
			const startTime = performance.now()
			await this.sendCheckpointSubscriptionEvent("CHECKPOINT_RESTORE", true, commitHash)
			const lockResult: FolderLockWithRetryResult = await tryAcquireCheckpointLockWithRetry(this.cwdHash, this.taskId)

			// Locking failed due to conflicting lock
			if (!lockResult.acquired && !lockResult.skipped) {
				throw new Error(
					"Failed to acquire checkpoint folder lock - another Cline instance may be performing checkpoint operations",
				)
			}

			// Locking skipped as we are in VS Code
			if (!lockResult.acquired && lockResult.skipped) {
				console.log("Skipping Checkpoints lock - VS Code")
			}

			if (lockResult.acquired) {
				lockAcquired = true
			}

			const gitPath = await getShadowGitPath(this.cwdHash)
			const git = simpleGit(path.dirname(gitPath))
			console.debug(`Using shadow git at: ${gitPath}`)
			await git.reset(["--hard", this.cleanCommitHash(commitHash)]) // Hard reset to target commit
			console.debug(`Successfully reset to checkpoint: ${commitHash}`)

			const durationMs = Math.round(performance.now() - startTime)
			await this.sendCheckpointSubscriptionEvent("CHECKPOINT_RESTORE", false, commitHash)
			telemetryService.captureCheckpointUsage(this.taskId, "restored", durationMs)
		} catch (error) {
			console.error("Failed to reset to checkpoint:", {
				taskId: this.taskId,
				commitHash,
				error,
			})
			throw error
		} finally {
			if (lockAcquired) {
				await releaseCheckpointLock(this.cwdHash, this.taskId)
			}
		}
	}

	/**
	 * Return an array describing changed files between one commit and either:
	 *   - another commit, or
	 *   - the current working directory (including uncommitted changes).
	 *
	 * If `rhsHash` is omitted, compares `lhsHash` to the working directory.
	 * If you want truly untracked files to appear, `git add` them first.
	 *
	 * @param lhsHash - The commit to compare from (older commit)
	 * @param rhsHash - The commit to compare to (newer commit).
	 *                  If omitted, we compare to the working directory.
	 * @returns Array of file changes with before/after content
	 */
	public async getDiffSet(
		lhsHash: string,
		rhsHash?: string,
	): Promise<
		Array<{
			relativePath: string
			absolutePath: string
			before: string
			after: string
		}>
	> {
		const startTime = performance.now()

		const gitPath = await getShadowGitPath(this.cwdHash)
		const git = simpleGit(path.dirname(gitPath))

		console.info(`Getting diff between commits: ${lhsHash || "initial"} -> ${rhsHash || "working directory"}`)

		// Stage all changes so that untracked files appear in diff summary
		await this.gitOperations.addCheckpointFiles(git)

		const cleanRhs = rhsHash ? this.cleanCommitHash(rhsHash) : undefined
		const diffRange = cleanRhs ? `${this.cleanCommitHash(lhsHash)}..${cleanRhs}` : this.cleanCommitHash(lhsHash)
		console.info(`Diff range: ${diffRange}`)
		const diffSummary = await git.diffSummary([diffRange])

		const result = []
		for (const file of diffSummary.files) {
			const filePath = file.file
			const absolutePath = path.join(this.cwd, filePath)

			// For extensionless files or dotfiles: exclude from diff result if binary
			const lastDotIndex = filePath.lastIndexOf(".")
			const lastSlashIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"))
			const ext = lastDotIndex > lastSlashIndex ? filePath.substring(lastDotIndex).toLowerCase() : ""
			const isDotfile = lastDotIndex !== -1 && lastDotIndex === lastSlashIndex + 1

			if (!ext || isDotfile) {
				try {
					const isBinary = await isBinaryFile(absolutePath).catch(() => false)
					if (isBinary) {
						continue
					}
				} catch {
					continue
				}
			}

			let beforeContent = ""
			try {
				beforeContent = await git.show([`${this.cleanCommitHash(lhsHash)}:${filePath}`])
			} catch (_) {
				// file didn't exist in older commit => remains empty
			}

			let afterContent = ""
			if (rhsHash) {
				try {
					afterContent = await git.show([`${this.cleanCommitHash(rhsHash)}:${filePath}`])
				} catch (_) {
					// file didn't exist in newer commit => remains empty
				}
			} else {
				try {
					afterContent = await fs.readFile(absolutePath, "utf8")
				} catch (_) {
					// file might be deleted => remains empty
				}
			}

			result.push({
				relativePath: filePath,
				absolutePath,
				before: beforeContent,
				after: afterContent,
			})
		}

		const durationMs = Math.round(performance.now() - startTime)
		telemetryService.captureCheckpointUsage(this.taskId, "diff_generated", durationMs)

		return result
	}

	/**
	 * Returns the number of files changed between two commits.
	 *
	 * @param lhsHash - The commit to compare from (older commit)
	 * @param rhsHash - The commit to compare to (newer commit).
	 *                  If omitted, we compare to the working directory.
	 * @returns The number of files changed between the commits
	 */
	public async getDiffCount(lhsHash: string, rhsHash?: string): Promise<number> {
		const startTime = performance.now()

		const gitPath = await getShadowGitPath(this.cwdHash)
		const git = simpleGit(path.dirname(gitPath))

		console.info(`Getting diff count between commits: ${lhsHash || "initial"} -> ${rhsHash || "working directory"}`)

		// Stage all changes so that untracked files appear in diff summary
		await this.gitOperations.addCheckpointFiles(git)

		const cleanRhs = rhsHash ? this.cleanCommitHash(rhsHash) : undefined
		const diffRange = cleanRhs ? `${this.cleanCommitHash(lhsHash)}..${cleanRhs}` : this.cleanCommitHash(lhsHash)
		const diffSummary = await git.diffSummary([diffRange])

		const durationMs = Math.round(performance.now() - startTime)
		telemetryService.captureCheckpointUsage(this.taskId, "diff_generated", durationMs)

		return diffSummary.files.length
	}
}

export default CheckpointTracker
