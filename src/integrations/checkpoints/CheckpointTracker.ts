import fs from "fs/promises"
import * as path from "path"
import simpleGit, { SimpleGit } from "simple-git"
import * as vscode from "vscode"
import { HistoryItem } from "../../shared/HistoryItem"
import { GitOperations } from "./CheckpointGitOperations"
import { getShadowGitPath, hashWorkingDir, getWorkingDirectory, detectLegacyCheckpoint } from "./CheckpointUtils"

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
 * - Maintains backward compatibility with legacy checkpoint structure
 * - Automatically cleans up by deleting task branches when tasks are removed
 */

class CheckpointTracker {
	private globalStoragePath: string
	private taskId: string
	private cwd: string
	private cwdHash: string
	private lastRetrievedShadowGitConfigWorkTree?: string
	private lastCheckpointHash?: string
	private isLegacyCheckpoint: boolean = false
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
		this.gitOperations = new GitOperations(cwd, false) // Initialize with non-legacy mode
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
	 * - Detects and handles legacy checkpoint structure
	 * - Sets up task-specific branch for new checkpoints
	 *
	 * Configuration:
	 * - Respects 'cline.enableCheckpoints' VS Code setting
	 * - Uses branch-per-task architecture for new checkpoints
	 * - Maintains backwards compatibility with legacy structure
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

			// Check if this is a legacy task
			newTracker.isLegacyCheckpoint = await detectLegacyCheckpoint(newTracker.globalStoragePath, newTracker.taskId)
			if (newTracker.isLegacyCheckpoint) {
				console.debug("Using legacy checkpoint path structure")
				const gitPath = await getShadowGitPath(
					newTracker.globalStoragePath,
					newTracker.taskId,
					newTracker.cwdHash,
					newTracker.isLegacyCheckpoint,
				)
				await GitOperations.initShadowGit(gitPath, workingDir, newTracker.isLegacyCheckpoint)
				await newTracker.gitOperations.switchToTaskBranch(newTracker.taskId, gitPath)
				return newTracker
			}

			// Branch-per-task structure
			const gitPath = await getShadowGitPath(
				newTracker.globalStoragePath,
				newTracker.taskId,
				newTracker.cwdHash,
				newTracker.isLegacyCheckpoint,
			)
			await GitOperations.initShadowGit(gitPath, workingDir, newTracker.isLegacyCheckpoint)
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
	 * - Handles both legacy and branch-per-task checkpoint structures
	 * - For new tasks, switches to task-specific branch first
	 * - Caches the created commit hash
	 *
	 * Commit structure:
	 * - Legacy: Simple "checkpoint" message
	 * - Branch-per-task: "checkpoint-{cwdHash}-{taskId}"
	 * - Always allows empty commits
	 *
	 * Dependencies:
	 * - Requires initialized shadow git (getShadowGitPath)
	 * - For new checkpoints, requires task branch setup
	 * - Uses addCheckpointFiles to stage changes
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
			const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash, this.isLegacyCheckpoint)
			const git = simpleGit(path.dirname(gitPath))

			console.info(`Using shadow git at: ${gitPath}`)

			// Disable nested git repos before any operations
			await this.gitOperations.renameNestedGitRepos(true)

			try {
				if (!this.isLegacyCheckpoint) {
					await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
				}
				await this.gitOperations.addCheckpointFiles(git, gitPath)

				const commitMessage = this.isLegacyCheckpoint ? "checkpoint" : "checkpoint-" + this.cwdHash + "-" + this.taskId

				console.info(
					`Creating ${this.isLegacyCheckpoint ? "legacy" : "new"} checkpoint commit with message: ${commitMessage}`,
				)
				const result = await git.commit(commitMessage, {
					"--allow-empty": null,
				})
				const commitHash = result.commit || ""
				this.lastCheckpointHash = commitHash
				console.warn(`Checkpoint commit created.`)
				return commitHash
			} finally {
				// Always re-enable nested git repos
				await this.gitOperations.renameNestedGitRepos(false)
			}
		} catch (error) {
			console.error("Failed to create checkpoint:", {
				taskId: this.taskId,
				error,
				isLegacyCheckpoint: this.isLegacyCheckpoint,
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
	 * - Handles both legacy and new checkpoint structures
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
			const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash, this.isLegacyCheckpoint)
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
		const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash, this.isLegacyCheckpoint)
		const git = simpleGit(path.dirname(gitPath))
		console.debug(`Using shadow git at: ${gitPath}`)
		await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
		await git.reset(["--hard", commitHash]) // Hard reset to target commit
		console.debug(`Successfully reset to checkpoint: ${commitHash}`)
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
		const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash, this.isLegacyCheckpoint)
		const git = simpleGit(path.dirname(gitPath))

		if (!this.isLegacyCheckpoint) {
			await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
		}

		console.info(`Getting diff between commits: ${lhsHash || "initial"} -> ${rhsHash || "working directory"}`)

		// If lhsHash is missing, use the initial commit of the repo
		let baseHash = lhsHash
		if (!baseHash) {
			const rootCommit = await git.raw(["rev-list", "--max-parents=0", "HEAD"])
			baseHash = rootCommit.trim()
			console.debug(`Using root commit as base: ${baseHash}`)
		}

		// Stage all changes so that untracked files appear in diff summary
		await this.gitOperations.addCheckpointFiles(git, gitPath)

		const diffSummary = rhsHash ? await git.diffSummary([`${baseHash}..${rhsHash}`]) : await git.diffSummary([baseHash])
		console.info(`Found ${diffSummary.files.length} changed files`)

		// For each changed file, gather before/after content
		const result = []
		const cwdPath = (await this.getShadowGitConfigWorkTree()) || this.cwd || ""
		const files = diffSummary.files.map((f) => f.file)
		const batchSize = 50

		// Get list of files that exist in base commit
		const existingFiles = await this.getExistingFiles(git, baseHash, files)

		// Process files in batches
		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize)

			// Split batch into existing and new files
			const existingBatch = batch.filter((file) => existingFiles.has(file))
			const newBatch = batch.filter((file) => !existingFiles.has(file))

			// Get before contents for existing files
			let beforeContents: string[] = new Array(batch.length).fill("")
			if (existingBatch.length > 0) {
				await git.addConfig("core.quotePath", "false")
				await git.addConfig("core.precomposeunicode", "true")
				const args = ["show", "--format="]
				existingBatch.forEach((file) => {
					args.push(`${baseHash}:${file}`)
				})
				const beforeResult = await git.raw(args)
				const existingContents = beforeResult.split("\n\0\n")
				// Map contents back to original batch positions
				existingBatch.forEach((file, index) => {
					const batchIndex = batch.indexOf(file)
					if (batchIndex !== -1) {
						beforeContents[batchIndex] = existingContents[index] || ""
					}
				})
			}

			// Get after contents
			let afterContents: string[] = []
			if (rhsHash) {
				// Split after files into existing and new in target commit
				const afterExistingFiles = await this.getExistingFiles(git, rhsHash, batch)
				const afterExistingBatch = batch.filter((file) => afterExistingFiles.has(file))

				if (afterExistingBatch.length > 0) {
					const args = ["show", "--format="]
					afterExistingBatch.forEach((file) => {
						args.push(`${rhsHash}:${file}`)
					})
					const afterResult = await git.raw(args)
					const existingContents = afterResult.split("\n\0\n")
					afterContents = new Array(batch.length).fill("")
					afterExistingBatch.forEach((file, index) => {
						const batchIndex = batch.indexOf(file)
						if (batchIndex !== -1) {
							afterContents[batchIndex] = existingContents[index] || ""
						}
					})
				}
			} else {
				// Read from disk for working directory changes
				afterContents = await Promise.all(
					batch.map(async (filePath) => {
						try {
							return await fs.readFile(path.join(cwdPath, filePath), "utf8")
						} catch (_) {
							return ""
						}
					}),
				)
			}

			// Add results for this batch
			for (let j = 0; j < batch.length; j++) {
				const filePath = batch[j]
				const absolutePath = path.join(cwdPath, filePath)
				result.push({
					relativePath: filePath,
					absolutePath,
					before: beforeContents[j] || "",
					after: afterContents[j] || "",
				})
			}
		}
		return result
	}

	/**
	 * Deletes all checkpoint data for a given task.
	 * Handles both legacy checkpoints and branch-per-task checkpoints.
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

	/**
	 * Helper function to get a set of files that exist in a given commit
	 */
	private async getExistingFiles(git: SimpleGit, commitHash: string, files: string[]): Promise<Set<string>> {
		try {
			const result = await git.raw(["ls-tree", "-r", "--name-only", commitHash])
			const existingFiles = new Set<string>(result.split("\n"))
			return existingFiles
		} catch (error) {
			console.error("Error getting existing files:", error)
			return new Set()
		}
	}
}

export default CheckpointTracker
