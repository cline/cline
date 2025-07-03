import * as path from "path"
import { execa } from "execa"
import { Logger } from "@services/logging/Logger"

/**
 * Validates that the workspace path is valid and writable for Git operations
 * @param workspacePath The workspace path to validate
 * @throws Error if the workspace path is invalid or not writable
 */
export async function validateWorkspacePath(workspacePath: string): Promise<void> {
	// Check if workspace path is valid
	if (!workspacePath || workspacePath === "/") {
		throw new Error(`Invalid workspace path: ${workspacePath}. Cannot initialize Git repository.`)
	}

	// Check if the directory exists
	try {
		await execa("test", ["-d", workspacePath])
	} catch (error) {
		throw new Error(`Workspace path does not exist or is not a directory: ${workspacePath}`)
	}

	// Check if the directory is writable
	try {
		const testFile = path.join(workspacePath, ".cline_write_test")
		await execa("touch", [testFile])
		await execa("rm", [testFile])
	} catch (error) {
		throw new Error(`Workspace path is not writable: ${workspacePath}. Error: ${error.message}`)
	}

	Logger.log(`Validated workspace path: ${workspacePath}`)
}

/**
 * Cleans up any existing Git repository in the specified workspace path
 * @param workspacePath The workspace path to clean up
 */
export async function cleanupPreviousGit(workspacePath: string): Promise<void> {
	const gitDir = path.join(workspacePath, ".git")

	try {
		// Check if .git directory exists using execa since we're already using it
		try {
			await execa("test", ["-d", gitDir])
			// If we get here, the directory exists
			Logger.log(`Removing existing Git repository in ${workspacePath}`)

			// Use rm -rf to remove the directory
			await execa("rm", ["-rf", gitDir])
			Logger.log(`Removed existing Git repository`)
		} catch (error) {
			// Directory doesn't exist, which is fine
			Logger.log(`No existing Git repository found in ${workspacePath}`)
		}
	} catch (error) {
		Logger.log(`Warning: Failed to remove existing Git repository: ${error.message}`)
	}
}

/**
 * Initializes a Git repository in the specified workspace path
 * @param workspacePath The workspace path to initialize Git in
 * @returns True if the repository was newly initialized
 */
export async function initializeGitRepository(workspacePath: string): Promise<boolean> {
	// Validate workspace path before proceeding
	await validateWorkspacePath(workspacePath)

	// Clean up any existing Git repository
	await cleanupPreviousGit(workspacePath)

	// Initialize a new Git repository
	Logger.log(`Initializing Git repository in ${workspacePath}`)
	try {
		await execa("git", ["init"], { cwd: workspacePath })
		await execa("git", ["config", "user.name", "Cline Evaluation"], { cwd: workspacePath })
		await execa("git", ["config", "user.email", "cline@example.com"], { cwd: workspacePath })

		// Try to create an initial commit, but don't fail if there are no files to commit
		try {
			// Check if there are any files to commit
			const { stdout: statusOutput } = await execa("git", ["status", "--porcelain"], { cwd: workspacePath })

			if (statusOutput.trim()) {
				// There are files to commit
				await execa("git", ["add", "."], { cwd: workspacePath })
				await execa("git", ["commit", "-m", "Initial commit for evaluation"], { cwd: workspacePath })
				Logger.log("Created initial Git commit in " + workspacePath)
			} else {
				// No files to commit, create an empty commit
				Logger.log("No files to commit, creating empty initial commit")
				try {
					// Create an empty commit with --allow-empty
					await execa("git", ["commit", "--allow-empty", "-m", "Initial empty commit for evaluation"], {
						cwd: workspacePath,
					})
					Logger.log("Created empty initial commit in " + workspacePath)
				} catch (emptyCommitError) {
					// Even empty commit failed, but we'll continue anyway
					Logger.log(`Warning: Failed to create empty commit: ${emptyCommitError.message}`)
				}
			}
		} catch (commitError) {
			// Initial commit failed, but Git is still initialized
			Logger.log(`Warning: Failed to create initial commit: ${commitError.message}`)
			Logger.log("Continuing without initial commit")
		}

		return true
	} catch (gitError) {
		// Only throw if Git initialization itself failed
		const errorMessage = `Failed to initialize Git repository: ${gitError.message}`
		Logger.log(errorMessage)
		throw new Error(errorMessage)
	}
}

/**
 * Gets the file changes between the current state and the initial state
 * @param workspacePath The workspace path to check for changes
 * @returns Object containing lists of created, modified, and deleted files, plus the full diff
 */
export async function getFileChanges(workspacePath: string): Promise<{
	created: string[]
	modified: string[]
	deleted: string[]
	diff: string
}> {
	// Validate workspace path before proceeding
	await validateWorkspacePath(workspacePath)

	// Make sure all changes are staged so they appear in the diff
	Logger.log(`Staging all changes in ${workspacePath} for diff`)
	try {
		// First check if there are any untracked files
		const { stdout: untrackedOutput } = await execa("git", ["ls-files", "--others", "--exclude-standard"], {
			cwd: workspacePath,
		})
		if (untrackedOutput.trim()) {
			Logger.log(`Found untracked files: ${untrackedOutput}`)
		}

		// Stage all changes including untracked files
		await execa("git", ["add", "-A"], { cwd: workspacePath })
		Logger.log("Staged all changes for diff")
	} catch (error) {
		Logger.log(`Warning: Failed to stage changes: ${error.message}`)
	}

	try {
		// Get list of changed files
		const { stdout: statusOutput } = await execa("git", ["status", "--porcelain"], { cwd: workspacePath })
		Logger.log(`Git status output: ${statusOutput || "(empty)"}`)

		const created: string[] = []
		const modified: string[] = []
		const deleted: string[] = []

		// Parse git status output
		statusOutput
			.split("\n")
			.filter(Boolean)
			.forEach((line) => {
				const status = line.substring(0, 2).trim()
				const file = line.substring(3)

				if (status === "A" || status === "??") {
					created.push(file)
				} else if (status === "M") {
					modified.push(file)
				} else if (status === "D") {
					deleted.push(file)
				}
			})

		// Get the full diff - include both staged and unstaged changes
		const { stdout: diffOutput } = await execa("git", ["diff", "--staged"], { cwd: workspacePath })
		Logger.log(`Git diff output length: ${diffOutput.length} characters`)

		// If there's no diff, try getting the diff of unstaged changes
		let finalDiff = diffOutput
		if (!finalDiff) {
			const { stdout: unstaged } = await execa("git", ["diff"], { cwd: workspacePath })
			finalDiff = unstaged
			Logger.log(`Unstaged git diff output length: ${unstaged.length} characters`)
		}

		return {
			created,
			modified,
			deleted,
			diff: finalDiff,
		}
	} catch (error) {
		// Throw the error instead of returning a fallback
		const errorMessage = `Error getting file changes: ${error.message}`
		Logger.log(errorMessage)
		throw new Error(errorMessage)
	}
}

/**
 * Calculates the tool success rate based on calls and failures
 * @param toolCalls Record of tool calls by name
 * @param toolFailures Record of tool failures by name
 * @returns The success rate as a number between 0 and 1
 */
export function calculateToolSuccessRate(toolCalls: Record<string, number>, toolFailures: Record<string, number>): number {
	const totalCalls = Object.values(toolCalls).reduce((a, b) => a + b, 0)
	const totalFailures = Object.values(toolFailures).reduce((a, b) => a + b, 0)

	if (totalCalls === 0) {
		return 1.0 // No calls means no failures
	}

	return 1.0 - totalFailures / totalCalls
}
