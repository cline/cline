import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import { globby } from "globby"
import * as path from "path"
import simpleGit, { type SimpleGit } from "simple-git"
import { telemetryService } from "@/services/telemetry"
import { getLfsPatterns, writeExcludesFile } from "./CheckpointExclusions"

interface CheckpointAddResult {
	success: boolean
}

/**
 * GitOperations Class
 *
 * Handles git-specific operations for Cline's Checkpoints system.
 *
 * Key responsibilities:
 * - Git repository initialization and configuration
 * - Git settings management (user, LFS, etc.)
 * - Worktree configuration and management
 * - Managing nested git repositories during checkpoint operations
 * - File staging and checkpoint creation
 * - Shadow git repository maintenance and cleanup
 */
export class GitOperations {
	private cwd: string

	/**
	 * Creates a new GitOperations instance.
	 *
	 * @param cwd - The current working directory for git operations
	 */
	constructor(cwd: string) {
		this.cwd = cwd
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
	 *
	 * @param gitPath - Path to the .git directory
	 * @param cwd - The current working directory for git operations
	 * @returns Promise<string> Path to the initialized .git directory
	 * @throws Error if:
	 * - Worktree verification fails for existing repository
	 * - Git initialization or configuration fails
	 * - Unable to create initial commit
	 * - LFS pattern setup fails
	 */
	public async initShadowGit(gitPath: string, cwd: string, taskId: string): Promise<string> {
		console.info(`Initializing shadow git`)

		// If repo exists, just verify worktree
		if (await fileExistsAtPath(gitPath)) {
			const git = simpleGit(path.dirname(gitPath))
			const worktree = await git.getConfig("core.worktree")
			if (worktree.value !== cwd) {
				throw new Error("Checkpoints can only be used in the original workspace: " + worktree.value)
			}
			console.warn(`Using existing shadow git at ${gitPath}`)

			// shadow git repo already exists, but update the excludes just in case
			await writeExcludesFile(gitPath, await getLfsPatterns(this.cwd))

			return gitPath
		}

		// Initialize new repo
		const startTime = performance.now()
		const checkpointsDir = path.dirname(gitPath)
		console.warn(`Creating new shadow git in ${checkpointsDir}`)

		const git = simpleGit(checkpointsDir)
		await git.init()

		// Configure repo with git settings
		await git.addConfig("core.worktree", cwd)
		await git.addConfig("commit.gpgSign", "false")
		await git.addConfig("user.name", "Cline Checkpoint")
		await git.addConfig("user.email", "checkpoint@cline.bot")

		// Set up LFS patterns
		const lfsPatterns = await getLfsPatterns(cwd)
		await writeExcludesFile(gitPath, lfsPatterns)

		const addFilesResult = await this.addCheckpointFiles(git)
		if (!addFilesResult.success) {
			console.error("Failed to add at least one file(s) to checkpoints shadow git")
			throw new Error("Failed to add at least one file(s) to checkpoints shadow git")
		}

		// Initial commit only on first repo creation
		await git.commit("initial commit", { "--allow-empty": null })

		const durationMs = Math.round(performance.now() - startTime)
		telemetryService.captureCheckpointUsage(taskId, "shadow_git_initialized", durationMs)

		console.warn(`Shadow git initialization completed`)

		return gitPath
	}

	/**
	 * Retrieves the worktree path from the shadow git configuration.
	 * The worktree path indicates where the shadow git repository is tracking files,
	 * which should match the current workspace directory.
	 *
	 * @param gitPath - Path to the .git directory
	 * @returns Promise<string | undefined> The worktree path or undefined if not found
	 * @throws Error if unable to get worktree path
	 */
	public async getShadowGitConfigWorkTree(gitPath: string): Promise<string | undefined> {
		try {
			const git = simpleGit(path.dirname(gitPath))
			const worktree = await git.getConfig("core.worktree")
			return worktree.value || undefined
		} catch (error) {
			console.error("Failed to get shadow git config worktree:", error)
			return undefined
		}
	}

	/**
	 * Since we use git to track checkpoints, we need to temporarily disable nested git repos to work around git's
	 * requirement of using submodules for nested repos.
	 *
	 * This method renames nested .git directories by adding/removing a suffix to temporarily disable/enable them.
	 * The root .git directory is preserved. Uses VS Code's workspace API to find nested .git directories and
	 * only processes actual directories (not files named .git).
	 *
	 * @param disable - If true, adds suffix to disable nested git repos. If false, removes suffix to re-enable them.
	 * @throws Error if renaming any .git directory fails
	 */
	public async renameNestedGitRepos(disable: boolean) {
		// Find all .git directories that are not at the root level
		const gitPaths = await globby("**/.git" + (disable ? "" : GIT_DISABLED_SUFFIX), {
			cwd: this.cwd,
			onlyDirectories: true,
			ignore: [".git"], // Ignore root level .git
			dot: true,
			markDirectories: false,
			suppressErrors: true,
		})

		// For each nested .git directory, rename it based on operation
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

	/**
	 * Adds files to the shadow git repository while handling nested git repos.
	 * Uses git commands to list files and stages them for commit.
	 * Respects .gitignore and handles LFS patterns.
	 *
	 * Process:
	 * 1. Updates exclude patterns from LFS config
	 * 2. Temporarily disables nested git repos
	 * 3. Gets list of tracked and untracked files from git (respecting .gitignore)
	 * 4. Adds all files to git staging
	 * 5. Re-enables nested git repos
	 *
	 * @param git - SimpleGit instance configured for the shadow git repo
	 * @returns Promise<CheckpointAddResult> Object containing success status, message, and file count
	 * @throws Error if:
	 *  - File operations fail
	 *  - Git commands error
	 *  - LFS pattern updates fail
	 *  - Nested git repo handling fails
	 */
	public async addCheckpointFiles(git: SimpleGit): Promise<CheckpointAddResult> {
		const startTime = performance.now()
		try {
			// Update exclude patterns before each commit
			await this.renameNestedGitRepos(true)
			console.info("Starting checkpoint add operation...")

			// Attempt to add all files. Any files with permissions errors will not be added,
			// but the process will proceed and add the rest (--ignore-errors).
			try {
				await git.add([".", "--ignore-errors"])
				const durationMs = Math.round(performance.now() - startTime)
				console.debug(`Checkpoint add operation completed in ${durationMs}ms`)
				return { success: true }
			} catch (_error) {
				return { success: false }
			}
		} catch (_error) {
			return { success: false }
		} finally {
			await this.renameNestedGitRepos(false)
		}
	}
}

export const GIT_DISABLED_SUFFIX = "_disabled"
