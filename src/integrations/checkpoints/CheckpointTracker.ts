import fs from "fs/promises"
import os from "os"
import * as path from "path"
import simpleGit, { SimpleGit } from "simple-git"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { fileExistsAtPath } from "../../utils/fs"
import { HistoryItem } from "../../shared/HistoryItem"
import { getLfsPatterns, writeExcludesFile, shouldExcludeFile } from "./CheckpointExclusions"

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
	}

	/**
	 * Private helper method that contains the core branch deletion logic.
	 * Used by both branch-per-task and legacy checkpoint deleteTaskBranch methods to clean up task branches.
	 * Handles switching branches if needed and preserves worktree configuration.
	 * @param git - SimpleGit instance to use for operations
	 * @param branchName - Name of the branch to delete
	 * @param checkpointsDir - Directory containing the shadow git repository
	 * @throws Error if branch deletion fails
	 */
	private static async deleteBranchForGit(git: SimpleGit, branchName: string, checkpointsDir: string): Promise<void> {
		// Check if branch exists
		const branches = await git.branchLocal()
		if (!branches.all.includes(branchName)) {
			console.log(`Task branch ${branchName} does not exist, nothing to delete`)
			return // Branch doesn't exist, nothing to delete
		}

		// First, if we're on the branch to be deleted, switch to master
		const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
		console.log(`Current branch: ${currentBranch}, target branch to delete: ${branchName}`)

		if (currentBranch === branchName) {
			console.log("Currently on branch to be deleted, switching to master first")
			// Save the current worktree config
			const worktree = await git.getConfig("core.worktree")
			console.log(`Saved current worktree config: ${worktree.value}`)

			try {
				// Temporarily unset worktree to prevent workspace modifications
				console.log("Temporarily unsetting worktree config")
				await git.raw(["config", "--unset", "core.worktree"])

				// Switch to master and delete branch
				console.log("Attempting to switch to master branch")
				await git.checkout("master")

				// Verify the switch completed - sometimes git hangs on the checkout
				let retries = 3
				while (retries > 0) {
					const newBranch = await git.revparse(["--abbrev-ref", "HEAD"])
					console.log(`Verifying branch switch - current branch: ${newBranch}, attempts left: ${retries}`)
					if (newBranch === "master") {
						console.log("Successfully switched to master branch")
						break
					}
					retries--
					if (retries === 0) {
						throw new Error("Failed to switch to master branch")
					}
				}

				console.log(`Deleting branch: ${branchName}`)
				await git.raw(["branch", "-D", branchName])
				console.log(`Successfully deleted branch: ${branchName}`)
			} finally {
				// Restore the worktree config
				if (worktree.value) {
					console.log(`Restoring worktree config to: ${worktree.value}`)
					await git.addConfig("core.worktree", worktree.value)
				}
			}
		} else {
			// If we're not on the branch, we can safely delete it
			console.log(`Directly deleting branch ${branchName} since we're not on it`)
			await git.raw(["branch", "-D", branchName])
			console.log(`Successfully deleted branch: ${branchName}`)
		}
	}

	/**
	 * Deletes the branch associated with this task.
	 * This is called when the active task is being deleted.
	 *
	 * Key behaviors:
	 * - For legacy checkpoints, deletes entire task directory (legacy behavior)
	 * - For new checkpoints, deletes just the task's branch
	 * - Ensures safe branch deletion even if currently checked out
	 *
	 * @returns Promise<void> Resolves when deletion is complete
	 * @throws Error if:
	 * - Shadow git path access fails
	 * - Legacy directory deletion fails
	 * - Branch deletion fails
	 * - Git operations error
	 */
	public async deleteTaskBranch(): Promise<void> {
		try {
			console.log("Starting task branch deletion process...")
			const gitPath = await this.getShadowGitPath()
			const checkpointsDir = path.dirname(gitPath)

			if (this.isLegacyCheckpoint) {
				console.log("Deleting legacy checkpoint directory")
				try {
					await fs.rm(checkpointsDir, { recursive: true, force: true })
					console.log("Successfully deleted legacy checkpoint directory")
				} catch (error) {
					console.error("Failed to delete legacy checkpoint directory:", error)
					throw error
				}
				return
			}

			console.log("Deleting task branch in new checkpoint structure")
			const git = simpleGit(checkpointsDir)
			const branchName = `task-${this.taskId}`

			await CheckpointTracker.deleteBranchForGit(git, branchName, checkpointsDir)
		} catch (error) {
			console.error("Failed to delete task branch:", error)
			throw new Error(`Failed to delete task branch: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Static method to delete a task's branch using the stored workspace path.
	 * This is called when deleting a task that is not the active task.
	 *
	 * For legacy checkpoints, this will delete the entire checkpoints directory for the task.
	 * For branch-per-task checkpoints, this will delete just the task's branch in the shared shadow git repo.
	 *
	 * @param taskId - The ID of the task whose branch should be deleted
	 * @param historyItem - The history item containing the shadow git config for this task
	 * @param provider - The ClineProvider instance, needed to access global storage paths
	 * @throws Error if the branch deletion fails or if global storage is invalid
	 */
	public static async deleteTaskBranch(taskId: string, historyItem: HistoryItem, provider?: ClineProvider): Promise<void> {
		try {
			console.log("Starting static task branch deletion process...")
			const globalStoragePath = provider?.context.globalStorageUri.fsPath
			if (!globalStoragePath) {
				throw new Error("Global storage uri is invalid")
			}

			// First check for legacy checkpoint
			const legacyCheckpointsDir = path.join(globalStoragePath, "tasks", taskId, "checkpoints")
			const legacyGitPath = path.join(legacyCheckpointsDir, ".git")

			if (await fileExistsAtPath(legacyGitPath)) {
				console.log("Found legacy checkpoint, deleting directory")
				try {
					await fs.rm(legacyCheckpointsDir, { recursive: true, force: true })
					console.log("Successfully deleted legacy checkpoint directory")
					return
				} catch (error) {
					console.error("Failed to delete legacy checkpoint directory:", error)
					throw error
				}
			}

			// No legacy checkpoint found, proceed with new structure
			if (!historyItem.shadowGitConfigWorkTree) {
				console.log("No shadow git config found for task")
				return
			}

			const workingDir = historyItem.shadowGitConfigWorkTree
			const cwdHash = CheckpointTracker.hashWorkingDir(workingDir)
			console.log(`Working directory: ${workingDir}, hash: ${cwdHash}`)

			const checkpointsDir = path.join(globalStoragePath, "checkpoints", cwdHash)
			const gitPath = path.join(checkpointsDir, ".git")

			// Verify the shadow git exists
			if (!(await fileExistsAtPath(gitPath))) {
				console.log(`No shadow git found for directory: ${workingDir}`)
				return
			}

			console.log("Deleting task branch in new checkpoint structure")
			const git = simpleGit(path.dirname(gitPath))
			const branchName = `task-${taskId}`

			await CheckpointTracker.deleteBranchForGit(git, branchName, checkpointsDir)
		} catch (error) {
			console.error("Failed to delete task branch:", error)
			throw new Error(`Failed to delete task branch: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Detects if the current task uses the legacy checkpoint structure.
	 * Legacy checkpoints stored each task's checkpoints in a separate git repository
	 * under the tasks/{taskId}/checkpoints directory. New checkpoints use a single
	 * repository with branches per task.
	 *
	 * @returns Promise<boolean> True if task uses legacy checkpoint structure, false otherwise
	 * @throws Error if unable to access global storage path
	 *
	 * Legacy path structure:
	 * globalStorage/
	 *   tasks/
	 *     {taskId}/
	 *       checkpoints/
	 *         .git/
	 *
	 * Branch-per-task structure:
	 * globalStorage/
	 *   checkpoints/
	 *     {cwdHash}/
	 *       .git/
	 */
	private async detectLegacyCheckpoint(): Promise<boolean> {
		console.log("Detecting if task uses legacy checkpoint...")
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			return false
		}
		const legacyGitPath = path.join(globalStoragePath, "tasks", this.taskId, "checkpoints", ".git")
		const isLegacy = await fileExistsAtPath(legacyGitPath)
		console.log(`Legacy checkpoint detection result: ${isLegacy}`)
		return isLegacy
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

			const workingDir = await CheckpointTracker.getWorkingDirectory()
			const cwdHash = CheckpointTracker.hashWorkingDir(workingDir)
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
	 * Creates a unique hash identifier for a working directory path.
	 * This hash is used to identify and organize shadow git repositories for different workspaces.
	 *
	 * The current implementation has limitations with repository renames and movement:
	 * - Moving a repository to a new location will create a new hash
	 * - Renaming the repository directory will create a new hash
	 * - This can lead to orphaned shadow repositories if workspaces are moved/renamed
	 *
	 * TODO: Replace with a more robust method that:
	 * - Handles repository moves and renames gracefully
	 * - Maintains consistent identification across workspace changes
	 *
	 * @param workingDir - Absolute path to the workspace directory to hash
	 * @returns A 13-digit numeric string hash of the directory path
	 */
	private static hashWorkingDir(workingDir: string): string {
		let hash = 0
		for (let i = 0; i < workingDir.length; i++) {
			hash = (hash * 31 + workingDir.charCodeAt(i)) >>> 0
		}
		const bigHash = BigInt(hash)
		const numericHash = bigHash.toString().slice(0, 13)
		return numericHash
	}

	/**
	 * Gets the working directory for the current workspace and validates it against sensitive directories.
	 * This method ensures checkpoints are not created in potentially dangerous locations like the home
	 * directory or common user directories.
	 *
	 * The method performs the following:
	 * 1. Gets the first workspace folder path from VS Code
	 * 2. Validates that a workspace is open
	 * 3. Checks the workspace path against sensitive directories
	 * 4. Returns the validated workspace path
	 *
	 * Sensitive directories that are blocked:
	 * - User's home directory
	 * - Desktop directory
	 * - Documents directory
	 * - Downloads directory
	 *
	 * @returns Promise<string> The absolute path to the validated workspace directory
	 * @throws Error if no workspace is open or if workspace is in a sensitive directory
	 */
	private static async getWorkingDirectory(): Promise<string> {
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)
		if (!cwd) {
			throw new Error("No workspace detected. Please open Cline in a workspace to use checkpoints.")
		}
		const homedir = os.homedir()
		const desktopPath = path.join(homedir, "Desktop")
		const documentsPath = path.join(homedir, "Documents")
		const downloadsPath = path.join(homedir, "Downloads")

		switch (cwd) {
			case homedir:
				throw new Error("Cannot use checkpoints in home directory")
			case desktopPath:
				throw new Error("Cannot use checkpoints in Desktop directory")
			case documentsPath:
				throw new Error("Cannot use checkpoints in Documents directory")
			case downloadsPath:
				throw new Error("Cannot use checkpoints in Downloads directory")
			default:
				return cwd
		}
	}

	/**
	 * Gets the path to the legacy shadow Git repository in globalStorage.
	 * Legacy checkpoints stored each task's checkpoints in a separate git repository
	 * under the tasks/{taskId}/checkpoints directory.
	 *
	 * The method performs the following:
	 * 1. Gets the global storage path from the provider reference
	 * 2. Constructs the legacy checkpoints directory path for this task
	 * 3. Creates the directory if it doesn't exist
	 * 4. Returns the path to the .git directory
	 *
	 * Legacy path structure:
	 * globalStorage/
	 *   tasks/
	 *     {taskId}/
	 *       checkpoints/
	 *         .git/
	 *
	 * @returns Promise<string> The absolute path to the legacy shadow git directory
	 * @throws Error if global storage path is invalid
	 */
	private async getLegacyShadowGitPath(): Promise<string> {
		console.log("Getting legacy shadow git path...")
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		const checkpointsDir = path.join(globalStoragePath, "checkpoints", this.cwdHash)
		await fs.mkdir(checkpointsDir, { recursive: true })
		const gitPath = path.join(checkpointsDir, ".git")
		console.log(`Legacy shadow git path: ${gitPath}`)
		return gitPath
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
		if (this.isLegacyCheckpoint) {
			return this.getLegacyShadowGitPath()
		}
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		const checkpointsDir = path.join(globalStoragePath, "checkpoints", this.cwdHash)
		await fs.mkdir(checkpointsDir, { recursive: true })
		const gitPath = path.join(checkpointsDir, ".git")
		return gitPath
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
		const git = simpleGit(path.dirname(gitPath))
		const branchName = `task-${this.taskId}`

		console.log(`Switching to task branch: ${branchName} in shadow git at ${gitPath}`)

		// Create new task-specific branch, or switch to one if it already exists.
		const branches = await git.branchLocal()
		if (!branches.all.includes(branchName)) {
			console.log(`Creating new task branch: ${branchName}`)
			await git.checkoutLocalBranch(branchName)
		} else {
			console.log(`Switching to existing task branch: ${branchName}`)
			await git.checkout(branchName)
		}

		const currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
		console.log(`Current branch after switch: ${currentBranch}`)
	}

	/**
	 * Checks if a shadow Git repository exists for the given task and workspace.
	 * This method handles both legacy and new checkpoint structures.
	 *
	 * For legacy checkpoints, checks for a .git directory at:
	 * globalStorage/tasks/{taskId}/checkpoints/.git
	 *
	 * For new checkpoints, checks for a .git directory at:
	 * globalStorage/checkpoints/{cwdHash}/.git
	 *
	 * @param taskId - The ID of the task to check for
	 * @param provider - ClineProvider instance for accessing VS Code extension context
	 * @returns Promise<boolean> True if shadow git exists, false otherwise
	 *
	 * @throws Error if working directory cannot be determined
	 */
	public static async doesShadowGitExist(taskId: string, provider?: ClineProvider): Promise<boolean> {
		const globalStoragePath = provider?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			return false
		}

		// Check legacy checkpoint path to see if this is a legacy task
		const legacyGitPath = path.join(globalStoragePath, "tasks", taskId, "checkpoints", ".git")
		if (await fileExistsAtPath(legacyGitPath)) {
			console.log("Found legacy shadow git")
			return true
		}

		// Check branch-per-task path for newer tasks
		const workingDir = await CheckpointTracker.getWorkingDirectory()
		const cwdHash = CheckpointTracker.hashWorkingDir(workingDir)
		const gitPath = path.join(globalStoragePath, "checkpoints", cwdHash, ".git")
		const exists = await fileExistsAtPath(gitPath)
		if (exists) {
			console.log("Found new shadow git")
		}
		return exists
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

		console.log(`Initializing ${this.isLegacyCheckpoint ? "legacy" : "new"} shadow git`)

		// If repo exists, just verify worktree
		if (await fileExistsAtPath(gitPath)) {
			const worktree = await this.getShadowGitConfigWorkTree()
			if (worktree !== this.cwd) {
				throw new Error("Checkpoints can only be used in the original workspace: " + worktree)
			}
			console.log(`Using existing ${this.isLegacyCheckpoint ? "legacy" : "new"} shadow git at ${gitPath}`)
			return gitPath
		}

		// Initialize new repo
		const checkpointsDir = path.dirname(gitPath)
		console.log(`Creating new ${this.isLegacyCheckpoint ? "legacy" : "new"} shadow git in ${checkpointsDir}`)

		const git = simpleGit(checkpointsDir)
		await git.init()

		// Configure repo
		await git.addConfig("core.worktree", this.cwd)
		await git.addConfig("commit.gpgSign", "false")
		await git.addConfig("user.name", "Cline Checkpoint")
		await git.addConfig("user.email", "checkpoint@cline.bot")

		// Set up LFS patterns
		const lfsPatterns = await getLfsPatterns(this.cwd)
		await writeExcludesFile(gitPath, lfsPatterns)

		// Initial commit only on first repo creation
		await git.commit("initial commit", { "--allow-empty": null })

		console.log(`${this.isLegacyCheckpoint ? "Legacy" : "New"} shadow git initialization completed`)

		return gitPath
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
			const git = simpleGit(path.dirname(gitPath))
			const worktree = await git.getConfig("core.worktree")
			this.lastRetrievedShadowGitConfigWorkTree = worktree.value || undefined
			return this.lastRetrievedShadowGitConfigWorkTree
		} catch (error) {
			console.error("Failed to get shadow git config worktree:", error)
			return undefined
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
			await this.renameNestedGitRepos(true)
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
			await this.renameNestedGitRepos(false)
		}
	}

	/**
	 * Since we use git to track checkpoints, we need to temporarily disable nested git repos to work around git's
	 * requirement of using submodules for nested repos.
	 *
	 * This method renames nested .git directories by adding/removing a suffix to temporarily disable/enable them.
	 * The root .git directory is preserved.
	 *
	 * @param disable - If true, adds suffix to disable nested git repos. If false, removes suffix to re-enable them.
	 * @param this.cwd - The current working directory to search for nested .git folders in
	 * @param GIT_DISABLED_SUFFIX - The suffix to append/remove from .git folders (defined as "_disabled")
	 *
	 * @throws Error if renaming any .git directory fails
	 */
	private async renameNestedGitRepos(disable: boolean) {
		// Find all .git directories that are not at the root level using VS Code API
		const gitFiles = await vscode.workspace.findFiles(
			new vscode.RelativePattern(this.cwd, "**/.git" + (disable ? "" : GIT_DISABLED_SUFFIX)),
			new vscode.RelativePattern(this.cwd, ".git/**"), // Exclude root .git (note trailing comma)
		)

		// Filter to only include directories
		const gitPaths: string[] = []
		for (const file of gitFiles) {
			const relativePath = path.relative(this.cwd, file.fsPath)
			try {
				const stats = await fs.stat(path.join(this.cwd, relativePath))
				if (stats.isDirectory()) {
					gitPaths.push(relativePath)
				}
			} catch {
				// Skip if stat fails
				continue
			}
		}

		// For each nested .git directory, rename it based on the disable flag
		for (const gitPath of gitPaths) {
			const fullPath = path.join(this.cwd, gitPath)
			let newPath: string
			if (disable) {
				newPath = fullPath + GIT_DISABLED_SUFFIX
			} else {
				newPath = fullPath.endsWith(GIT_DISABLED_SUFFIX) ? fullPath.slice(0, -GIT_DISABLED_SUFFIX.length) : fullPath
			}

			try {
				await fs.rename(fullPath, newPath)
				console.log(`CheckpointTracker ${disable ? "disabled" : "enabled"} nested git repo ${gitPath}`)
			} catch (error) {
				console.error(`CheckpointTracker failed to ${disable ? "disable" : "enable"} nested git repo ${gitPath}:`, error)
			}
		}
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}
}

export const GIT_DISABLED_SUFFIX = "_disabled"

export default CheckpointTracker
