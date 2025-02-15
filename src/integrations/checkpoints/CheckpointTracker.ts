import fs from "fs/promises"
import os from "os"
import * as path from "path"
import simpleGit, { SimpleGit } from "simple-git"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { HistoryItem } from "../../shared/HistoryItem"
import { getLfsPatterns, writeExcludesFile } from "./CheckpointExclusions"
import { GitOperations } from "./GitOperations"
import { getShadowGitPath, hashWorkingDir, getWorkingDirectory,detectLegacyCheckpoint } from "./CheckpointUtils"

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
 * Checkpoint behavior:
 * - Utilizes a branch-per-task architecture to consilidate shadow gits and reduve overall checkpoint size
 * - Handles legacy checkpoints use for minimal user disruption with older tasks
 * - Deletes branches when a task is deleted, legacy task deletions delete older checkpoints using legacy method
 */

class CheckpointTracker {
	private providerRef: WeakRef<ClineProvider>
	private taskId: string
	private disposables: vscode.Disposable[] = []
	private cwd: string
	private cwdHash: string
	private lastRetrievedShadowGitConfigWorkTree?: string
	lastCheckpointHash?: string
	private isLegacyCheckpoint: boolean = false
	private gitOperations: GitOperations


	/**
	 * Creates a new CheckpointTracker instance to manage checkpoints for a specific task.
	 * The constructor is private - use the static create() method to instantiate.
	 *
	 * @param provider - The ClineProvider instance for accessing VS Code functionality
	 * @param taskId - Unique identifier for the task being tracked
	 * @param cwd - The current working directory to track files in
	 * @param cwdHash - Hash of the working directory path for shadow git organization
	 */
	private constructor(provider: ClineProvider, taskId: string, cwd: string, cwdHash: string) {
		this.providerRef = new WeakRef(provider)
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
	 * @param provider - ClineProvider instance for accessing VS Code extension context
	 * @returns Promise resolving to new CheckpointTracker instance, or undefined if checkpoints are disabled
	 * @throws Error if:
	 * - Provider is not supplied
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
	public static async create(taskId: string, provider?: ClineProvider): Promise<CheckpointTracker | undefined> {
		try {
			console.log(`Creating new CheckpointTracker for task ${taskId}`)
			if (!provider) {
				throw new Error("Provider is required to create a checkpoint tracker")
			}

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
			console.log(`Initializing checkpoint tracking in directory: ${workingDir}`)
			console.log(`Repository ID (cwdHash): ${cwdHash}`)

			const newTracker = new CheckpointTracker(provider, taskId, workingDir, cwdHash)

			// Check if this is a legacy checkpoint
			newTracker.isLegacyCheckpoint = await newTracker.detectLegacyCheckpoint()
			if (newTracker.isLegacyCheckpoint) {
				console.log("Using legacy checkpoint path structure")
				await newTracker.initShadowGit(cwdHash)
				return newTracker
			}

			// New checkpoint structure
			await newTracker.initShadowGit(cwdHash)
			await newTracker.switchToTaskBranch()
			return newTracker
		} catch (error) {
			console.error("Failed to create CheckpointTracker:", error)
			throw error
		}
	}


	/**
	 * Adds files to the shadow git repository while handling nested git repos and applying exclusion rules.
	 * Uses git commands to list files, then applies custom exclusion patterns.
	 *
	 * Process:
	 * 1. Updates exclude patterns from LFS config
	 * 2. Temporarily disables nested git repos
	 * 3. Gets list of tracked and untracked files from git
	 * 4. Applies custom exclusion rules
	 * 5. Adds filtered files to git staging
	 * 6. Re-enables nested git repos
	 *
	 * @param git - SimpleGit instance configured for the shadow git repo
	 * @returns Promise<void>
	 * @throws Error if file operations fail or git commands error
	 *
	 * File selection:
	 * - Uses git ls-files to get both tracked and untracked files
	 * - Respects .gitignore rules
	 * - Applies additional custom exclusions from CheckpointExclusions
	 *
	 * Safety:
	 * - Handles nested git repos by temporarily disabling them
	 * - Restores nested repos even if operation fails
	 * - Validates paths before adding
	 */
	private async addCheckpointFiles(git: SimpleGit): Promise<void> {
		try {
			// Update exclude patterns before each commit
			await writeExcludesFile(await this.getShadowGitPath(), await getLfsPatterns(this.cwd))
			await this.gitOperations.renameNestedGitRepos(true)
			console.log("Starting checkpoint add operation...")

			// Get list of all files git would track (respects .gitignore)
			const gitFiles = (await git.raw(["ls-files", "--others", "--exclude-standard", "--cached"]))
				.split("\n")
				.filter(Boolean)
			console.log(`Found ${gitFiles.length} files from git to check for exclusions:`)
			//console.log("Git files:", gitFiles)

			const filesToAdd: string[] = []

			console.log("filesToAdd: ", filesToAdd)

			const excludedFiles: Array<{ path: string; reason: string }> = []

			// Apply our custom exclusions
			for (const relativePath of gitFiles) {
				filesToAdd.push(relativePath)
			}

			// Log exclusions
			if (excludedFiles.length > 0) {
				console.log(`Excluded ${excludedFiles.length} files:`)
				//console.log("Excluded files:", excludedFiles)
			}

			// Add filtered files
			if (filesToAdd.length === 0) {
				console.log("No files to add to checkpoint")
				return
			}

			try {
				console.log(`Adding ${filesToAdd.length} files to checkpoint:`)
				//console.log("Files to add:", filesToAdd)
				await git.add(filesToAdd)
				console.log("Checkpoint add operation completed successfully")
			} catch (error) {
				console.error("Checkpoint add operation failed:", error)
				throw error
			}
		} catch (error) {
			console.error("Failed to add files to checkpoint:", error)
			throw error
		} finally {
			await this.gitOperations.renameNestedGitRepos(false)
		}
	}

	/**
	 * Creates a new checkpoint commit in the shadow git repository.
	 *
	 * Key behaviors:
	 * - Creates commit with checkpoint files in shadow git repo
	 * - Handles both legacy and new checkpoint structures
	 * - For new checkpoints, switches to task-specific branch first
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
			console.log(`Creating new checkpoint commit for task ${this.taskId}`)
			const gitPath = await this.getShadowGitPath()
			const git = simpleGit(path.dirname(gitPath))

			console.log(`Using shadow git at: ${gitPath}`)
			if (!this.isLegacyCheckpoint) {
				await this.switchToTaskBranch()
			}
			await this.addCheckpointFiles(git)

			const commitMessage = this.isLegacyCheckpoint ? "checkpoint" : "checkpoint-" + this.cwdHash + "-" + this.taskId

			console.log(`Creating ${this.isLegacyCheckpoint ? "legacy" : "new"} checkpoint commit with message: ${commitMessage}`)
			const result = await git.commit(commitMessage, {
				"--allow-empty": null,
			})
			const commitHash = result.commit || ""
			this.lastCheckpointHash = commitHash
			console.log(`Created checkpoint commit: ${commitHash}`)
			return commitHash
		} catch (error) {
			console.error("Failed to create checkpoint:", error)
			return undefined
		}
	}



	/**
	 * Detects if the current task uses the legacy checkpoint structure.
	 * @returns Promise<boolean> True if task uses legacy checkpoint structure, false otherwise
	 */
	private async detectLegacyCheckpoint(): Promise<boolean> {
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		return detectLegacyCheckpoint(globalStoragePath, this.taskId)
	}


	/**
	 * Gets the path to the shadow Git repository in globalStorage.
	 * For legacy checkpoints, delegates to getLegacyShadowGitPath().
	 * For new checkpoints, uses the consolidated branch-per-task structure.
	 *
	 * The method performs the following:
	 * 1. Checks if this is a legacy checkpoint and delegates if so
	 * 2. Gets the global storage path from the provider reference
	 * 3. Constructs the checkpoints directory path using the workspace hash
	 * 4. Creates the directory if it doesn't exist
	 * 5. Returns the path to the .git directory
	 *
	 * @returns Promise<string> The absolute path to the shadow git directory
	 * @throws Error if global storage path is invalid
	 */
	private async getShadowGitPath(): Promise<string> {
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		return getShadowGitPath(
			globalStoragePath || "",
			this.taskId,
			this.cwdHash,
			this.isLegacyCheckpoint
		)
	}

	/**
	 * Switches to or creates a task-specific branch in the shadow Git repository.
	 * For legacy checkpoints, this is a no-op since they use separate repositories.
	 * For new checkpoints, this ensures we're on the correct task branch before operations.
	 *
	 * The method performs the following:
	 * 1. Checks if this is a legacy checkpoint and returns early if so
	 * 2. Gets the shadow git path and initializes simple-git
	 * 3. Constructs the branch name using the task ID
	 * 4. Checks if the branch exists:
	 *    - If not, creates a new branch
	 *    - If yes, switches to the existing branch
	 * 5. Verifies the branch switch completed successfully
	 *
	 * Branch naming convention:
	 * task-{taskId}
	 *
	 * @returns Promise<void>
	 * @throws Error if branch operations fail or git commands error
	 */
	private async switchToTaskBranch(): Promise<void> {
		if (this.isLegacyCheckpoint) {
			console.log("Skipping branch operations for legacy checkpoint")
			return
		}
		const gitPath = await this.getShadowGitPath()
		await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
	}

	/**
	 * Initializes or verifies a shadow Git repository for checkpoint tracking.
	 * Creates a new repository if one doesn't exist, or verifies the worktree
	 * configuration if it does.
	 *
	 * Key operations:
	 * - Creates/verifies shadow git repository
	 * - Configures git settings (user, LFS, etc.)
	 * - Sets up worktree to point to workspace
	 * - Creates initial empty commit
	 * - Handles both legacy and new checkpoint structures
	 *
	 * Legacy path structure:
	 * globalStorage/
	 *   tasks/
	 *     {taskId}/
	 *       checkpoints/
	 *         .git/
	 *
	 * Branch-per-task path structure:
	 * globalStorage/
	 *   checkpoints/
	 *     {cwdHash}/
	 *       .git/
	 *
	 * Git Configuration:
	 * - core.worktree: Set to workspace directory
	 * - commit.gpgSign: Disabled
	 * - user.name: "Cline Checkpoint"
	 * - user.email: "checkpoint@cline.bot"
	 *
	 * @param cwdHash - Hash of the working directory path used for repository identification
	 * @returns Promise<string> Path to the initialized .git directory
	 * @throws Error if:
	 * - Worktree verification fails for existing repository
	 * - Git initialization or configuration fails
	 * - Unable to create initial commit
	 * - LFS pattern setup fails
	 */
	public async initShadowGit(cwdHash: string): Promise<string> {
		const gitPath = await this.getShadowGitPath()
		this.gitOperations = new GitOperations(this.cwd, this.isLegacyCheckpoint) // Update with current legacy mode
		return this.gitOperations.initShadowGit(gitPath)
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
			const gitPath = await this.getShadowGitPath()
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
		console.log(`Resetting to checkpoint: ${commitHash}`)
		const gitPath = await this.getShadowGitPath()
		const git = simpleGit(path.dirname(gitPath))
		console.log(`Using shadow git at: ${gitPath}`)
		await this.switchToTaskBranch()
		await git.reset(["--hard", commitHash]) // Hard reset to target commit
		console.log(`Successfully reset to checkpoint: ${commitHash}`)
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
		const gitPath = await this.getShadowGitPath()
		const git = simpleGit(path.dirname(gitPath))
		await this.switchToTaskBranch()

		console.log(`Getting diff between commits: ${lhsHash || "initial"} -> ${rhsHash || "working directory"}`)

		// If lhsHash is missing, use the initial commit of the repo
		let baseHash = lhsHash
		if (!baseHash) {
			const rootCommit = await git.raw(["rev-list", "--max-parents=0", "HEAD"])
			baseHash = rootCommit.trim()
			console.log(`Using root commit as base: ${baseHash}`)
		}

		// Stage all changes so that untracked files appear in diff summary
		await this.addCheckpointFiles(git)

		const diffSummary = rhsHash ? await git.diffSummary([`${baseHash}..${rhsHash}`]) : await git.diffSummary([baseHash])
		console.log(`Found ${diffSummary.files.length} changed files`)

		// For each changed file, gather before/after content
		const result = []
		const cwdPath = (await this.getShadowGitConfigWorkTree()) || this.cwd || ""

		for (const file of diffSummary.files) {
			const filePath = file.file
			const absolutePath = path.join(cwdPath, filePath)

			let beforeContent = ""
			try {
				beforeContent = await git.show([`${baseHash}:${filePath}`])
			} catch (_) {
				// file didn't exist in older commit => remains empty
			}

			let afterContent = ""
			if (rhsHash) {
				// if user provided a newer commit, use git.show at that commit
				try {
					afterContent = await git.show([`${rhsHash}:${filePath}`])
				} catch (_) {
					// file didn't exist in newer commit => remains empty
				}
			} else {
				// otherwise, read from disk (includes uncommitted changes)
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
	 * Handles both legacy checkpoints and branch-per-task checkpoints.
	 *
	 * @param taskId - The ID of the task whose checkpoints should be deleted
	 * @param historyItem - The history item containing the shadow git config for this task
	 * @param provider - The ClineProvider instance, needed to access global storage paths
	 * @throws Error if deletion fails
	 */
	public static async deleteCheckpoints(taskId: string, historyItem: HistoryItem, provider?: ClineProvider): Promise<void> {
		const globalStoragePath = provider?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		await GitOperations.deleteTaskBranchStatic(taskId, historyItem, globalStoragePath)
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}
}

export default CheckpointTracker
