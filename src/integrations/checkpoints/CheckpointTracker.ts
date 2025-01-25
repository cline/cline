import fs from "fs/promises"
import os from "os"
import * as path from "path"
import simpleGit, { SimpleGit } from "simple-git"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { fileExistsAtPath } from "../../utils/fs"
import { globby } from "globby"
import { FileAccessTracker } from "./FileAccessTracker"

class CheckpointTracker {
	private providerRef: WeakRef<ClineProvider>
	private taskId: string
	private disposables: vscode.Disposable[] = []
	private cwd: string
	private lastRetrievedShadowGitConfigWorkTree?: string
	private fileTracker: FileAccessTracker
	lastCheckpointHash?: string
	private renamedGitRepos: Set<string> = new Set()

	private constructor(provider: ClineProvider, taskId: string, cwd: string) {
		this.providerRef = new WeakRef(provider)
		this.taskId = taskId
		this.cwd = cwd
		this.fileTracker = new FileAccessTracker(cwd)
		this.initializeFileTracker()
	}

	private async initializeFileTracker(): Promise<void> {
		await this.fileTracker.initialize()
	}

	public static async create(taskId: string, provider?: ClineProvider): Promise<CheckpointTracker> {
		try {
			if (!provider) {
				throw new Error("Provider is required to create a checkpoint tracker")
			}

			// Check if git is installed by attempting to get version
			try {
				await simpleGit().version()
			} catch (error) {
				throw new Error("Git must be installed to use checkpoints.") // FIXME: must match what we check for in TaskHeader to show link
			}

			const cwd = await CheckpointTracker.getWorkingDirectory()
			const newTracker = new CheckpointTracker(provider, taskId, cwd)
			await newTracker.initShadowGit()
			return newTracker
		} catch (error) {
			console.error("Failed to create CheckpointTracker:", error)
			throw error
		}
	}

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

	private async getShadowGitPath(): Promise<string> {
		const globalStoragePath = this.providerRef.deref()?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}
		const checkpointsDir = path.join(globalStoragePath, "tasks", this.taskId, "checkpoints")
		await fs.mkdir(checkpointsDir, { recursive: true })
		const gitPath = path.join(checkpointsDir, ".git")
		return gitPath
	}

	public static async doesShadowGitExist(taskId: string, provider?: ClineProvider): Promise<boolean> {
		const globalStoragePath = provider?.context.globalStorageUri.fsPath
		if (!globalStoragePath) {
			return false
		}
		const gitPath = path.join(globalStoragePath, "tasks", taskId, "checkpoints", ".git")
		return await fileExistsAtPath(gitPath)
	}

	public async initShadowGit(): Promise<string> {
		const gitPath = await this.getShadowGitPath()
		if (await fileExistsAtPath(gitPath)) {
			// Make sure it's the same cwd as the configured worktree
			const worktree = await this.getShadowGitConfigWorkTree()
			if (worktree !== this.cwd) {
				throw new Error("Checkpoints can only be used in the original workspace: " + worktree)
			}

			return gitPath
		} else {
			const checkpointsDir = path.dirname(gitPath)
			const git = simpleGit(checkpointsDir)
			console.log('CheckpointTracker: Initializing new Git repository:', {
				path: checkpointsDir,
				worktree: this.cwd
			})
			await git.init()

			// Configure Git settings
			await git.addConfig("core.worktree", this.cwd) // sets the working tree to the current workspace
			await git.addConfig("commit.gpgSign", "false") // Disable commit signing for shadow repo
			await git.addConfig("gc.auto", "1000") // Tune garbage collection
			await git.addConfig("gc.autoPackLimit", "2")
			await git.addConfig("index.sparse", "true") // Enable sparse index

			// Get LFS patterns from workspace if they exist
			let lfsPatterns: string[] = []
			try {
				const attributesPath = path.join(this.cwd, ".gitattributes")
				if (await fileExistsAtPath(attributesPath)) {
					const attributesContent = await fs.readFile(attributesPath, "utf8")
					lfsPatterns = attributesContent
						.split("\n")
						.filter((line) => line.includes("filter=lfs"))
						.map((line) => line.split(" ")[0].trim())
				}
			} catch (error) {
				console.warn("Failed to read .gitattributes:", error)
			}

			// Add basic excludes directly in git config, while respecting any .gitignore in the workspace
			// .git/info/exclude is local to the shadow git repo, so it's not shared with the main repo - and won't conflict with user's .gitignore
			// TODO: let user customize these
			const excludesPath = path.join(gitPath, "info", "exclude")
			await fs.mkdir(path.join(gitPath, "info"), { recursive: true })
			await fs.writeFile(
				excludesPath,
				[
					".git/", // ignore the user's .git
					`.git${GIT_DISABLED_SUFFIX}/`, // ignore the disabled nested git repos
					".DS_Store",
					"*.log",
					"node_modules/",
					"__pycache__/",
					"env/",
					"venv/",
					"target/dependency/",
					"build/dependencies/",
					"dist/",
					"out/",
					"bundle/",
					"vendor/",
					"tmp/",
					"temp/",
					"deps/",
					"pkg/",
					"Pods/",
					// Media files
					"*.jpg",
					"*.jpeg",
					"*.png",
					"*.gif",
					"*.bmp",
					"*.ico",
					// "*.svg",
					"*.mp3",
					"*.mp4",
					"*.wav",
					"*.avi",
					"*.mov",
					"*.wmv",
					"*.webm",
					"*.webp",
					"*.m4a",
					"*.flac",
					// Build and dependency directories
					"build/",
					"bin/",
					"obj/",
					".gradle/",
					".idea/",
					".vscode/",
					".vs/",
					"coverage/",
					".next/",
					".nuxt/",
					// Cache and temporary files
					"*.cache",
					"*.tmp",
					"*.temp",
					"*.swp",
					"*.swo",
					"*.pyc",
					"*.pyo",
					".pytest_cache/",
					".eslintcache",
					// Environment and config files
					".env*",
					"*.local",
					"*.development",
					"*.production",
					// Large data files
					"*.zip",
					"*.tar",
					"*.gz",
					"*.rar",
					"*.7z",
					"*.iso",
					"*.bin",
					"*.exe",
					"*.dll",
					"*.so",
					"*.dylib",
					// Database files
					"*.sqlite",
					"*.db",
					"*.sql",
					// Log files
					"*.logs",
					"*.error",
					"npm-debug.log*",
					"yarn-debug.log*",
					"yarn-error.log*",
					...lfsPatterns,
				].join("\n"),
			)

			// Set up git identity (git throws an error if user.name or user.email is not set)
			await git.addConfig("user.name", "Cline Checkpoint")
			await git.addConfig("user.email", "noreply@example.com")

			await this.addAllFiles(git)
			// Initial commit (--allow-empty ensures it works even with no files)
			console.log('CheckpointTracker: Creating initial commit')
			await git.commit("initial commit", { "--allow-empty": null })

			return gitPath
		}
	}

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

	public async commit(): Promise<string | undefined> {
		try {
			const gitPath = await this.getShadowGitPath()
			const git = simpleGit(path.dirname(gitPath))
			await this.addAllFiles(git)
			console.log('CheckpointTracker: Creating checkpoint commit')
			const result = await git.commit("checkpoint", {
				"--allow-empty": null,
			})
			const commitHash = result.commit || ""
			this.lastCheckpointHash = commitHash
			return commitHash
		} catch (error) {
			console.error("Failed to create checkpoint:", error)
			return undefined
		}
	}

	public async resetHead(commitHash: string): Promise<void> {
		const gitPath = await this.getShadowGitPath()
		const git = simpleGit(path.dirname(gitPath))

		// Verify worktree configuration
		const worktree = await this.getShadowGitConfigWorkTree()
		if (worktree !== this.cwd) {
			throw new Error("Cannot restore checkpoint: workspace mismatch. The checkpoint was created in a different workspace.")
		}

		try {
			// Get list of tracked files in the checkpoint
			const trackedFiles = (await git.raw(['ls-tree', '-r', '--name-only', commitHash])).split('\n').filter(Boolean)
			console.log('CheckpointTracker: Restoring checkpoint:', {
				commitHash,
				worktree: this.cwd,
				trackedFileCount: trackedFiles.length
			})

			// Create a list of paths to protect (files not in the checkpoint)
			const currentFiles = await globby("**/*", {
				cwd: this.cwd,
				dot: true,
				onlyFiles: true,
				ignore: [
					".git/**",
					"node_modules/**",
					...trackedFiles // Ignore files that are in the checkpoint since we'll restore them
				]
			})

			// First reset the tracked files
			console.log('CheckpointTracker: Resetting to commit:', commitHash)
			await git.reset(["--hard", commitHash])

			// Then clean only the files that were tracked in the checkpoint
			// This ensures we don't delete files that weren't part of the checkpoint
			const filesToClean = trackedFiles.filter(file => {
				// Don't clean files that exist in currentFiles (they weren't in the checkpoint)
				return !currentFiles.includes(file)
			})

			if (filesToClean.length > 0) {
				console.log('CheckpointTracker: Cleaning files:', {
					count: filesToClean.length,
					files: filesToClean
				})
				// Create a temporary file with paths to clean
				const cleanListPath = path.join(gitPath, "clean-list")
				await fs.writeFile(cleanListPath, filesToClean.join('\n'))

				// Use pathspec-from-file to only clean specific files
				await git.clean("f", ["-d", "--pathspec-from-file", cleanListPath])

				// Clean up temp file
				await fs.unlink(cleanListPath)
			}

			console.log('CheckpointTracker: Checkpoint restore completed:', {
				restoredFiles: filesToClean.length,
				preservedFiles: currentFiles.length
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Failed to restore checkpoint:", errorMessage)
			throw new Error(`Failed to restore checkpoint: ${errorMessage}`)
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

		// If lhsHash is missing, use the initial commit of the repo
		let baseHash = lhsHash
		if (!baseHash) {
			const rootCommit = await git.raw(["rev-list", "--max-parents=0", "HEAD"])
			baseHash = rootCommit.trim()
		}

		// Stage all changes so that untracked files appear in diff summary
		await this.addAllFiles(git)

		const diffSummary = rhsHash ? await git.diffSummary([`${baseHash}..${rhsHash}`]) : await git.diffSummary([baseHash])

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

	private async addAllFiles(git: SimpleGit) {
		// Get list of tracked files first
		const trackedFiles = this.fileTracker.getAccessedFiles()

		if (trackedFiles.length === 0) {
			// If no files were tracked, add an empty commit
			return
		}

		// Check total size of tracked files
		const totalSize = await this.fileTracker.getTotalTrackedSize()
		const maxSize = 1024 * 1024 * 1024 // 1GB default
		if (totalSize > maxSize) {
			console.warn(`Total tracked files size (${totalSize} bytes) exceeds limit (${maxSize} bytes)`)
			return
		}

		// Only rename git repos in directories we're actually tracking
		await this.renameNestedGitRepos(true, trackedFiles)
		try {
			// Add all tracked files in one operation
			console.log('CheckpointTracker: Adding files to Git:', {
				files: trackedFiles.map(f => path.relative(this.cwd, f))
			})
			await git.add(trackedFiles)

			// Run garbage collection if needed
			console.log('CheckpointTracker: Running Git garbage collection')
			await git.raw(['gc', '--auto'])

			// Log checkpoint stats
			const stats = this.fileTracker.getStats()
			console.log('CheckpointTracker: Checkpoint stats:', {
				totalFiles: stats.totalFiles,
				excludedFiles: stats.excludedFiles,
				checkpointSize: `${(stats.checkpointSize / 1024 / 1024).toFixed(2)}MB`,
				duration: `${(stats.duration / 1000).toFixed(2)}s`
			})
		} catch (error) {
			console.error("Failed to add files to git:", error)
		} finally {
			// Only restore git repos in directories we renamed
			await this.renameNestedGitRepos(false, trackedFiles)
		}
	}

	/**
	 * Track a file access operation
	 * @param filePath Path to the file being accessed
	 * @param operation Type of operation ("read" or "write")
	 */
	public async trackFileAccess(filePath: string, operation: "read" | "write"): Promise<void> {
		await this.fileTracker.trackFileAccess(filePath, operation)
	}

	// Since we use git to track checkpoints, we need to temporarily disable nested git repos to work around git's requirement of using submodules for nested repos.
	private async renameNestedGitRepos(disable: boolean, trackedFiles?: string[]) {
		// If we have tracked files, only look in their directories
		const searchPaths = trackedFiles
			? [...new Set(trackedFiles.map(f => path.dirname(path.join(this.cwd, f))))]
			: [this.cwd]

		const processedPaths = new Set<string>()

		for (const searchPath of searchPaths) {
			// Skip if we've already processed this path
			if (processedPaths.has(searchPath)) continue
			processedPaths.add(searchPath)

			const gitPaths = await globby("**/.git" + (disable ? "" : GIT_DISABLED_SUFFIX), {
				cwd: searchPath,
				onlyDirectories: true,
				ignore: [".git"], // Ignore root level .git
				dot: true,
				markDirectories: false,
			})

			// Process all nested .git directories concurrently
			const renamePromises = gitPaths.map(async (gitPath) => {
				const fullGitPath = path.join(searchPath, gitPath)

				// Skip if we've already handled this repo in this session
				const repoKey = path.relative(this.cwd, fullGitPath)
				if (disable) {
					if (this.renamedGitRepos.has(repoKey)) return
				} else {
					if (!this.renamedGitRepos.has(repoKey)) return
				}

				let newPath: string
				if (disable) {
					newPath = fullGitPath + GIT_DISABLED_SUFFIX
					this.renamedGitRepos.add(repoKey)
				} else {
					newPath = fullGitPath.endsWith(GIT_DISABLED_SUFFIX)
						? fullGitPath.slice(0, -GIT_DISABLED_SUFFIX.length)
						: fullGitPath
					this.renamedGitRepos.delete(repoKey)
				}

				try {
					await fs.rename(fullGitPath, newPath)
					console.log(`CheckpointTracker: ${disable ? "Disabled" : "Enabled"} nested Git repo:`, {
						repo: repoKey,
						operation: disable ? "disable" : "enable"
					})
				} catch (error) {
					console.error(`CheckpointTracker failed to ${disable ? "disable" : "enable"} nested git repo ${repoKey}:`, error)
				}
			})

			// Wait for all rename operations to complete
			await Promise.all(renamePromises)
		}
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
	}
}

const GIT_DISABLED_SUFFIX = "_disabled"

export default CheckpointTracker
