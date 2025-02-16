import fs from "fs/promises"
import os from "os"
import * as path from "path"
import simpleGit from "simple-git"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
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
			console.log(`Repository ID (cwdHash): ${cwdHash}`)

			const newTracker = new CheckpointTracker(provider, taskId, workingDir, cwdHash)

			// Check if this is a legacy task
			newTracker.isLegacyCheckpoint = await detectLegacyCheckpoint(
				newTracker.providerRef.deref()?.context.globalStorageUri.fsPath,
				newTracker.taskId,
			)
			if (newTracker.isLegacyCheckpoint) {
				console.log("Using legacy checkpoint path structure")
				const gitPath = await getShadowGitPath(
					newTracker.providerRef.deref()?.context.globalStorageUri.fsPath || "",
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
				newTracker.providerRef.deref()?.context.globalStorageUri.fsPath || "",
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
			console.log(`Creating new checkpoint commit for task ${this.taskId}`)
			const gitPath = await getShadowGitPath(
				this.providerRef.deref()?.context.globalStorageUri.fsPath || "",
				this.taskId,
				this.cwdHash,
				this.isLegacyCheckpoint,
			)
			const git = simpleGit(path.dirname(gitPath))

			console.log(`Using shadow git at: ${gitPath}`)
			if (!this.isLegacyCheckpoint) {
				await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
			}
			await this.gitOperations.addCheckpointFiles(git, gitPath)

			const commitMessage = this.isLegacyCheckpoint ? "checkpoint" : "checkpoint-" + this.cwdHash + "-" + this.taskId

			console.log(`Creating ${this.isLegacyCheckpoint ? "legacy" : "new"} checkpoint commit with message: ${commitMessage}`)
			const result = await git.commit(commitMessage, {
				"--allow-empty": null,
			})
			const commitHash = result.commit || ""
			this.lastCheckpointHash = commitHash
			console.log(`Checkpoint commit created.`)
			return commitHash
		} catch (error) {
			console.error("Failed to create checkpoint:", error)
			return undefined
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
			const gitPath = await getShadowGitPath(
				this.providerRef.deref()?.context.globalStorageUri.fsPath || "",
				this.taskId,
				this.cwdHash,
				this.isLegacyCheckpoint,
			)
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
		const gitPath = await getShadowGitPath(
			this.providerRef.deref()?.context.globalStorageUri.fsPath || "",
			this.taskId,
			this.cwdHash,
			this.isLegacyCheckpoint,
		)
		const git = simpleGit(path.dirname(gitPath))
		console.log(`Using shadow git at: ${gitPath}`)
		await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
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
		const gitPath = await getShadowGitPath(
			this.providerRef.deref()?.context.globalStorageUri.fsPath || "",
			this.taskId,
			this.cwdHash,
			this.isLegacyCheckpoint,
		)
		const git = simpleGit(path.dirname(gitPath))

		if (!this.isLegacyCheckpoint) {
			await this.gitOperations.switchToTaskBranch(this.taskId, gitPath)
		}

		console.log(`Getting diff between commits: ${lhsHash || "initial"} -> ${rhsHash || "working directory"}`)

		// If lhsHash is missing, use the initial commit of the repo
		let baseHash = lhsHash
		if (!baseHash) {
			const rootCommit = await git.raw(["rev-list", "--max-parents=0", "HEAD"])
			baseHash = rootCommit.trim()
			console.log(`Using root commit as base: ${baseHash}`)
		}

		// Stage all changes so that untracked files appear in diff summary
		await this.gitOperations.addCheckpointFiles(git, gitPath)

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
