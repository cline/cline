import fs from "fs/promises"
import * as path from "path"
import simpleGit from "simple-git"
import * as vscode from "vscode"
import { HistoryItem } from "../../shared/HistoryItem"
import { telemetryService } from "../../services/telemetry/TelemetryService"
import { GitOperations } from "./CheckpointGitOperations"
import { getShadowGitPath, hashWorkingDir, getWorkingDirectory } from "./CheckpointUtils"

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
 * - Uses a branch-per-task model to consolidate shadow git repositories
 * - Each task gets its own branch within a single shadow git per workspace
 * - Automatically cleans up by deleting task branches when tasks are removed
 */

class CheckpointTracker {
	private globalStoragePath: string
	private taskId: string
	private cwd: string
	private cwdHash: string
	private lastRetrievedShadowGitConfigWorkTree?: string
	private gitOperations: GitOperations

	/**
	 * Creates a new CheckpointTracker instance to manage checkpoints for a specific task.
	 * The constructor is private - use the static create() method to instantiate.
	 *
	 * @param taskId - Unique identifier for the task being tracked
	 * @param cwd - The current working directory to track files in
	 * @param cwdHash - Hash of the working directory path for shadow git organization
	 */
	private constructor(globalStoragePath: string, taskId: string, cwd: string, cwdHash: string) {
		this.globalStoragePath = globalStoragePath
		this.taskId = taskId
		this.cwd = cwd
		this.cwdHash = cwdHash
		this.gitOperations = new GitOperations(cwd)
	}

	/**
	 * Creates a new CheckpointTracker instance for tracking changes in a task.
	 * Handles initialization of the shadow git repository and branch setup.
	 *
	 * @param taskId - Unique identifier for the task to track
	 * @param globalStoragePath - the globalStorage path
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
	 * - Sets up task-specific branch for new checkpoints
	 *
	 * Configuration:
	 * - Respects 'cline.enableCheckpoints' VS Code setting
	 * - Uses branch-per-task architecture for new checkpoints
	 */
	public static async create(taskId: string, globalStoragePath: string | undefined): Promise<CheckpointTracker | undefined> {
		if (!globalStoragePath) {
			throw new Error("Global storage path is required to create a checkpoint tracker")
		}
		try {
			console.info(`Creating new CheckpointTracker for task ${taskId}`)

			// Check if checkpoints are disabled in VS Code settings
			const enableCheckpoints = vscode.workspace.getConfiguration("cline").get<boolean>("enableCheckpoints") ?? true
			if (!enableCheckpoints) {
				return undefined // Don't create tracker when disabled
			}

			// Check if git is installed by attempting to get version
			try {
				await simpleGit().version()
			} catch (error) {
				throw new Error("Git must be installed to use checkpoints.") // FIXME: must match what we check for in TaskHeader to show link
			}

			const workingDir = await getWorkingDirectory()
			const cwdHash = hashWorkingDir(workingDir)
			console.debug(`Repository ID (cwdHash): ${cwdHash}`)

			const newTracker = new CheckpointTracker(globalStoragePath, taskId, workingDir, cwdHash)

			// Branch-per-task structure
			const gitPath = await getShadowGitPath(newTracker.globalStoragePath, newTracker.taskId, newTracker.cwdHash)
			await newTracker.gitOperations.initShadowGit(gitPath, workingDir)

			telemetryService.captureCheckpointUsage(taskId, "shadow_git_initialized")

			await newTracker.gitOperations.switchToTaskBranch(newTracker.taskId, gitPath)

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
	 * - Creates commit with checkpoint files in shadow git repo
	 * - For new tasks, switches to task-specific branch first
	 * - Caches the created commit hash
	 *
	 * Commit structure:
	 * - Branch-per-task: "checkpoint-{cwdHash}-{taskId}"
	 * - Always allows empty commits
	 *
	 * Dependencies:
	 * - Requires initialized shadow git (getShadowGitPath)
	 * - For new checkpoints, requires task branch setup
	 * - Uses addCheckpointFiles to stage changes using 'git add .'
	 * - Relies on git's native exclusion handling via the exclude file
	 *
	 * @returns Promise<string | undefined> The created commit hash, or undefined if:
	 * - Shadow git access fails
	 * - Branch switch fails
	 * - Staging files fails
	 * - Commit creation fails
	 * @throws Error if unable to:
	 * - Access shadow git path
	 * - Initialize simple-git
	 * - Switch branches
	 * - Stage or commit files
	 */
	public async commit(): Promise<string | undefined> {
		try {
			console.info(`Creating new checkpoint commit for task ${this.taskId}`)
			const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash)
			const git = simpleGit(path.dirname(gitPath))

			console.info(`Using shadow git at: ${gitPath}`)

			await this.gitOperations.addCheckpointFiles(git)

			const commitMessage = "checkpoint-" + this.cwdHash + "-" + this.taskId

			console.info(`Creating checkpoint commit with message: ${commitMessage}`)
			const result = await git.commit(commitMessage, {
				"--allow-empty": null,
			})
			const commitHash = result.commit || ""
			console.warn(`Checkpoint commit created.`)
			telemetryService.captureCheckpointUsage(this.taskId, "commit_created")
			return commitHash
		} catch (error) {
			console.error("Failed to create checkpoint:", {
				taskId: this.taskId,
				error,
			})
			throw new Error(`Failed to create checkpoint: ${error instanceof Error ? error.message : String(error)}`)
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
			const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash)
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
	 * Dependencies:
	 * - Requires initialized shadow git (getShadowGitPath)
	 * - For new checkpoints, requires task branch setup
	 * - Must be called with a valid commit hash from this task's history
	 *
	 * @param commitHash - The hash of the checkpoint commit to reset to
	 * @returns Promise<void> Resolves when reset is complete
	 * @throws Error if unable to:
	 * - Access shadow git path
	 * - Initialize simple-git
	 * - Switch to task branch
	 * - Reset to target commit
	 */
	public async resetHead(commitHash: string): Promise<void> {
		console.info(`Resetting to checkpoint: ${commitHash}`)
		const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash)
		const git = simpleGit(path.dirname(gitPath))
		console.debug(`Using shadow git at: ${gitPath}`)
		await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
		await git.reset(["--hard", commitHash]) // Hard reset to target commit
		console.debug(`Successfully reset to checkpoint: ${commitHash}`)
		telemetryService.captureCheckpointUsage(this.taskId, "restored")
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
		lhsHash?: string,
		rhsHash?: string,
	): Promise<
		Array<{
			relativePath: string
			absolutePath: string
			before: string
			after: string
		}>
	> {
		const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash)
		const git = simpleGit(path.dirname(gitPath))

		console.info(`Getting diff between commits: ${lhsHash || "initial"} -> ${rhsHash || "working directory"}`)

		// If lhsHash is missing, iteratively check up to 5 commits to find the first one with tracked files
		let baseHash = lhsHash
		if (!baseHash) {
			// Ensure we're on the correct task branch before getting commits
			await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)

			// Verify which branch we're on after switching
			const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
			console.info(`Getting commits from branch: ${currentBranch}`)

			try {
				// Get all commits that match the checkpoint pattern for this specific task
				const commitPattern = `checkpoint-${this.cwdHash}-${this.taskId}`
				const branchCommits = await git.log(["--grep", commitPattern, "--reverse"])
				if (!branchCommits.all.length) {
					throw new Error("No commits found in the branch.")
				}
				// Get the first commit that matches our task's checkpoint pattern
				baseHash = branchCommits.all[0].hash
			} catch (error) {
				console.error("Failed to get branch commits:", error)
				throw new Error("Failed to determine branch history")
			}
		}

		// Stage all changes so that untracked files appear in diff summary
		await this.gitOperations.addCheckpointFiles(git)

		const diffRange = rhsHash ? `${baseHash}..${rhsHash}` : baseHash
		console.info(`Diff range: ${diffRange}`)
		const diffSummary = await git.diffSummary([diffRange])

		const result = []
		for (const file of diffSummary.files) {
			const filePath = file.file
			const absolutePath = path.join(this.cwd, filePath)

			let beforeContent = ""
			try {
				beforeContent = await git.show([`${baseHash}:${filePath}`])
			} catch (_) {
				// file didn't exist in older commit => remains empty
			}

			let afterContent = ""
			if (rhsHash) {
				try {
					afterContent = await git.show([`${rhsHash}:${filePath}`])
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

		return result
	}

	/**
	 * Deletes all checkpoint data for a given task.
	 *
	 * @param taskId - The ID of the task whose checkpoints should be deleted
	 * @param historyItem - The history item containing the shadow git config for this task
	 * @param globalStoragePath - the globalStorage path
	 * @throws Error if deletion fails
	 */
	public static async deleteCheckpoints(taskId: string, historyItem: HistoryItem, globalStoragePath: string): Promise<void> {
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		await GitOperations.deleteTaskBranchStatic(taskId, historyItem, globalStoragePath)
	}
}

export default CheckpointTracker
