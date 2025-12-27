import { exec } from "child_process"
import * as path from "path"
import { promisify } from "util"
import { copyWorktreeIncludeFiles } from "./worktree-include"

const execAsync = promisify(exec)

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
		await execAsync("git --version")
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
		await execAsync("git rev-parse --git-dir", { cwd })
		return true
	} catch (_error) {
		return false
	}
}

/**
 * Get the current worktree path
 */
async function getCurrentWorktreePath(cwd: string): Promise<string> {
	try {
		const { stdout } = await execAsync("git rev-parse --show-toplevel", { cwd })
		return stdout.trim()
	} catch (_error) {
		return cwd
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
		const { stdout } = await execAsync("git worktree list --porcelain", { cwd })

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
		let command: string

		if (options.createNewBranch && options.branch) {
			// Create a new branch and worktree
			if (options.baseBranch) {
				command = `git worktree add -b "${options.branch}" "${worktreePath}" "${options.baseBranch}"`
			} else {
				command = `git worktree add -b "${options.branch}" "${worktreePath}"`
			}
		} else if (options.branch) {
			// Checkout existing branch
			command = `git worktree add "${worktreePath}" "${options.branch}"`
		} else {
			// Create detached worktree at HEAD
			command = `git worktree add --detach "${worktreePath}"`
		}

		await execAsync(command, { cwd })

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
export async function deleteWorktree(cwd: string, path: string, force: boolean = false): Promise<WorktreeResult> {
	const isInstalled = await checkGitInstalled()
	if (!isInstalled) {
		return { success: false, message: "Git is not installed" }
	}

	const isRepo = await checkGitRepo(cwd)
	if (!isRepo) {
		return { success: false, message: "Not a git repository" }
	}

	try {
		const command = force ? `git worktree remove --force "${path}"` : `git worktree remove "${path}"`

		await execAsync(command, { cwd })

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
		// Get current branch
		let currentBranch = ""
		try {
			const { stdout: currentStdout } = await execAsync("git branch --show-current", { cwd })
			currentBranch = currentStdout.trim()
		} catch {
			// Detached HEAD state
			currentBranch = ""
		}

		// Get local branches
		const { stdout: localStdout } = await execAsync("git branch --format='%(refname:short)'", { cwd })
		const localBranches = localStdout
			.trim()
			.split("\n")
			.map((b) => b.trim().replace(/^'|'$/g, ""))
			.filter(Boolean)

		// Get remote branches
		const { stdout: remoteStdout } = await execAsync("git branch -r --format='%(refname:short)'", { cwd })
		const remoteBranches = remoteStdout
			.trim()
			.split("\n")
			.map((b) => b.trim().replace(/^'|'$/g, ""))
			.filter((b) => b && !b.includes("HEAD"))

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
		console.error("Error getting available branches:", error)
		return { localBranches: [], remoteBranches: [], currentBranch: "" }
	}
}
