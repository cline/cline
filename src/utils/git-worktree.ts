import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import * as os from "node:os"
import * as path from "path"
import simpleGit from "simple-git"
import { Logger } from "@/shared/services/Logger"
import { copyWorktreeIncludeFiles } from "./worktree-include"

export interface Worktree {
	path: string
	branch: string
	commitHash: string
	isCurrent: boolean
	isBare: boolean
	isDetached: boolean
	isLocked: boolean
	lockReason?: string
}

export interface WorktreeResult {
	success: boolean
	message: string
	worktree?: Worktree
}

export interface BranchInfo {
	localBranches: string[]
	remoteBranches: string[]
	currentBranch: string
}

/**
 * Check if git is installed
 */
async function checkGitInstalled(): Promise<boolean> {
	try {
		await simpleGit().version()
		return true
	} catch (_error) {
		return false
	}
}

/**
 * Check if a directory is a git repository
 */
async function checkGitRepo(cwd: string): Promise<boolean> {
	try {
		const git = simpleGit(cwd)
		return await git.checkIsRepo()
	} catch (_error) {
		return false
	}
}

/**
 * Get the current worktree path (same as git root for main worktree)
 */
async function getCurrentWorktreePath(cwd: string): Promise<string> {
	try {
		const git = simpleGit(cwd)
		const root = await git.revparse(["--show-toplevel"])
		return root.trim()
	} catch (_error) {
		return cwd
	}
}

/**
 * Get the git repository root path for a given directory.
 * Returns null if not in a git repository.
 */
export async function getGitRootPath(cwd: string): Promise<string | null> {
	const isInstalled = await checkGitInstalled()
	if (!isInstalled) {
		return null
	}

	try {
		const git = simpleGit(cwd)
		const isRepo = await git.checkIsRepo()
		if (!isRepo) {
			return null
		}
		const root = await git.revparse(["--show-toplevel"])
		return root.trim()
	} catch (_error) {
		return null
	}
}

/**
 * List all worktrees in the repository
 */
export async function listWorktrees(cwd: string): Promise<{ worktrees: Worktree[]; isGitRepo: boolean; error?: string }> {
	const isInstalled = await checkGitInstalled()
	if (!isInstalled) {
		return { worktrees: [], isGitRepo: false, error: "Git is not installed" }
	}

	const isRepo = await checkGitRepo(cwd)
	if (!isRepo) {
		return { worktrees: [], isGitRepo: false, error: "Not a git repository" }
	}

	try {
		const currentPath = await getCurrentWorktreePath(cwd)
		const git = simpleGit(cwd)
		const stdout = await git.raw(["worktree", "list", "--porcelain"])

		const worktrees: Worktree[] = []
		const entries = stdout.trim().split("\n\n").filter(Boolean)

		for (const entry of entries) {
			const lines = entry.split("\n")
			const worktree: Partial<Worktree> = {
				isLocked: false,
				isDetached: false,
				isBare: false,
				isCurrent: false,
			}

			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					worktree.path = line.substring(9)
					worktree.isCurrent = worktree.path === currentPath
				} else if (line.startsWith("HEAD ")) {
					worktree.commitHash = line.substring(5)
				} else if (line.startsWith("branch ")) {
					// Branch ref like "refs/heads/main" -> "main"
					const branchRef = line.substring(7)
					worktree.branch = branchRef.replace("refs/heads/", "")
				} else if (line === "bare") {
					worktree.isBare = true
				} else if (line === "detached") {
					worktree.isDetached = true
					worktree.branch = ""
				} else if (line === "locked") {
					worktree.isLocked = true
				} else if (line.startsWith("locked ")) {
					worktree.isLocked = true
					worktree.lockReason = line.substring(7)
				}
			}

			if (worktree.path) {
				worktrees.push(worktree as Worktree)
			}
		}

		return { worktrees, isGitRepo: true }
	} catch (error) {
		return {
			worktrees: [],
			isGitRepo: true,
			error: `Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Create a new worktree
 */
export async function createWorktree(
	cwd: string,
	worktreePath: string,
	options: {
		branch?: string
		baseBranch?: string
		createNewBranch?: boolean
	} = {},
): Promise<WorktreeResult> {
	const isInstalled = await checkGitInstalled()
	if (!isInstalled) {
		return { success: false, message: "Git is not installed" }
	}

	const isRepo = await checkGitRepo(cwd)
	if (!isRepo) {
		return { success: false, message: "Not a git repository" }
	}

	try {
		const git = simpleGit(cwd)
		const args: string[] = ["worktree", "add"]

		if (options.createNewBranch && options.branch) {
			// Create a new branch and worktree
			args.push("-b", options.branch, worktreePath)
			if (options.baseBranch) {
				args.push(options.baseBranch)
			}
		} else if (options.branch) {
			// Checkout existing branch
			args.push(worktreePath, options.branch)
		} else {
			// Create detached worktree at HEAD
			args.push("--detach", worktreePath)
		}

		await git.raw(args)

		// Resolve the absolute path of the new worktree
		const absoluteWorktreePath = path.isAbsolute(worktreePath) ? worktreePath : path.resolve(cwd, worktreePath)

		// Copy files matched by .worktreeinclude (if it exists)
		const { copiedCount, errors: copyErrors } = await copyWorktreeIncludeFiles(cwd, absoluteWorktreePath)

		// Get the created worktree info
		const { worktrees } = await listWorktrees(cwd)
		const createdWorktree = worktrees.find((w) => w.path === absoluteWorktreePath)

		let message = `Worktree created at ${worktreePath}`
		if (copiedCount > 0) {
			message += ` (copied ${copiedCount} file${copiedCount === 1 ? "" : "s"} from .worktreeinclude)`
		}
		if (copyErrors.length > 0) {
			message += `. Some files failed to copy: ${copyErrors.slice(0, 3).join(", ")}`
			if (copyErrors.length > 3) {
				message += ` and ${copyErrors.length - 3} more`
			}
		}

		return {
			success: true,
			message,
			worktree: createdWorktree,
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Delete a worktree
 */
export async function deleteWorktree(cwd: string, path: string, force = false): Promise<WorktreeResult> {
	const isInstalled = await checkGitInstalled()
	if (!isInstalled) {
		return { success: false, message: "Git is not installed" }
	}

	const isRepo = await checkGitRepo(cwd)
	if (!isRepo) {
		return { success: false, message: "Not a git repository" }
	}

	try {
		const git = simpleGit(cwd)
		const args = force ? ["worktree", "remove", "--force", path] : ["worktree", "remove", path]

		await git.raw(args)

		return {
			success: true,
			message: `Worktree at ${path} has been removed`,
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Get available branches for creating worktrees
 */
export async function getAvailableBranches(cwd: string): Promise<BranchInfo> {
	const isInstalled = await checkGitInstalled()
	if (!isInstalled) {
		return { localBranches: [], remoteBranches: [], currentBranch: "" }
	}

	const isRepo = await checkGitRepo(cwd)
	if (!isRepo) {
		return { localBranches: [], remoteBranches: [], currentBranch: "" }
	}

	try {
		const git = simpleGit(cwd)

		// Get current branch
		let currentBranch = ""
		try {
			currentBranch = await git.revparse(["--abbrev-ref", "HEAD"])
			currentBranch = currentBranch.trim()
			if (currentBranch === "HEAD") {
				// Detached HEAD state
				currentBranch = ""
			}
		} catch {
			// Detached HEAD state
			currentBranch = ""
		}

		// Get all branches using branchLocal and branch -r
		const branchSummary = await git.branchLocal()
		const localBranches = branchSummary.all

		// Get remote branches
		const remoteBranchSummary = await git.branch(["-r"])
		const remoteBranches = remoteBranchSummary.all.filter((b) => !b.includes("HEAD"))

		// Filter out branches that already have worktrees
		const { worktrees } = await listWorktrees(cwd)
		const usedBranches = new Set(worktrees.map((w) => w.branch).filter(Boolean))

		const availableLocalBranches = localBranches.filter((b) => !usedBranches.has(b))
		const availableRemoteBranches = remoteBranches.filter((b) => {
			// Remote branches like "origin/main" -> check if "main" is used
			const shortName = b.split("/").slice(1).join("/")
			return !usedBranches.has(shortName)
		})

		return {
			localBranches: availableLocalBranches,
			remoteBranches: availableRemoteBranches,
			currentBranch,
		}
	} catch (error) {
		Logger.error("Error getting available branches:", error)
		return { localBranches: [], remoteBranches: [], currentBranch: "" }
	}
}

/**
 * Root directory under which auto-created task worktrees are placed.
 * Follows the convention shared with Kanban: ~/.cline/worktrees/<taskId>/<repoName>/
 */
export function getTaskWorktreesHomePath(): string {
	return path.join(os.homedir(), ".cline", "worktrees")
}

/**
 * Sanitize a path segment so it's safe to use as a directory name.
 * Strips path separators, control characters, and trims; falls back to "workspace".
 */
function sanitizeRepoNameForWorktreePath(repoPath: string): string {
	const folder = path.basename(repoPath.replace(/[\\/]+$/g, "")) || "workspace"
	const cleaned = [...folder]
		.filter((char) => {
			const code = char.charCodeAt(0)
			return code >= 32 && code !== 127 && char !== "/" && char !== "\\"
		})
		.join("")
		.trim()
	return cleaned || "workspace"
}

export interface CreateTaskWorktreeResult {
	success: boolean
	message: string
	/** Absolute path of the new worktree, when success is true. */
	path?: string
	/** Identifier used as the parent directory name under ~/.cline/worktrees/. */
	taskId?: string
	/** Absolute path of the source repository root (the "main" worktree), when success is true. */
	repoRoot?: string
}

/**
 * Auto-create a detached-HEAD worktree for a new Cline task.
 *
 * Detects the git repo root for `cwd`, then creates a worktree at
 *   `~/.cline/worktrees/<taskId>/<repoName>/`
 * pointing at the current HEAD. The directory name convention matches Kanban
 * so worktrees from different surfaces (CLI, VS Code, JetBrains, Kanban) sit
 * side-by-side under a single root.
 *
 * Any surface that wants to "run this task in a fresh worktree" can call this
 * and then use the returned `path` as the workspace cwd.
 */
export async function createTaskWorktree(options: {
	cwd: string
	/** Optional override for the worktree id (parent directory name). Defaults to a uuid. */
	taskId?: string
}): Promise<CreateTaskWorktreeResult> {
	const repoRoot = await getGitRootPath(options.cwd)
	if (!repoRoot) {
		return {
			success: false,
			message: `Not a git repository: ${options.cwd}. --worktree requires a git repo.`,
		}
	}

	const taskId = options.taskId?.trim() || randomUUID()
	if (taskId.includes("/") || taskId.includes("\\") || taskId.includes("..")) {
		return { success: false, message: `Invalid worktree id: ${taskId}` }
	}

	const repoName = sanitizeRepoNameForWorktreePath(repoRoot)
	const worktreePath = path.join(getTaskWorktreesHomePath(), taskId, repoName)

	try {
		await mkdir(path.dirname(worktreePath), { recursive: true })
	} catch (error) {
		return {
			success: false,
			message: `Failed to create worktree parent directory: ${error instanceof Error ? error.message : String(error)}`,
		}
	}

	// Detached worktree at HEAD — same as Kanban's `git worktree add --detach <path> <baseCommit>`.
	const result = await createWorktree(repoRoot, worktreePath, {})
	if (!result.success) {
		return { success: false, message: result.message }
	}

	return {
		success: true,
		message: result.message,
		path: worktreePath,
		taskId,
		repoRoot,
	}
}
