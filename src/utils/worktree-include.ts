import { exec } from "child_process"
import * as fs from "fs/promises"
import ignore from "ignore"
import * as path from "path"
import { promisify } from "util"

const execAsync = promisify(exec)

/** Batch size for parallel file operations */
const COPY_BATCH_SIZE = 100

/**
 * Parses a .gitignore-style file and returns the patterns
 */
async function parseIgnoreFile(filePath: string): Promise<string[]> {
	try {
		const content = await fs.readFile(filePath, "utf-8")
		return content
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
	} catch {
		return []
	}
}

/**
 * Check if a pattern represents a directory (ends with / or is a bare name that exists as a directory)
 */
async function isDirectoryPattern(sourceDir: string, pattern: string): Promise<string | null> {
	// Normalize pattern - remove trailing slash
	const cleanPattern = pattern.replace(/\/$/, "")

	// Skip patterns with wildcards - these need file-by-file matching
	if (cleanPattern.includes("*") || cleanPattern.includes("?") || cleanPattern.includes("[")) {
		return null
	}

	// Check if this is a top-level directory
	const dirPath = path.join(sourceDir, cleanPattern)
	try {
		const stat = await fs.stat(dirPath)
		if (stat.isDirectory()) {
			return cleanPattern
		}
	} catch {
		// Path doesn't exist or can't be accessed
	}

	return null
}

/**
 * Copy a directory using native cp -r (much faster than recursive Node.js copy)
 */
async function copyDirectoryNative(source: string, target: string): Promise<void> {
	// Create parent directory if needed
	await fs.mkdir(path.dirname(target), { recursive: true })

	// Use native cp for performance (10-20x faster than Node.js)
	const isWindows = process.platform === "win32"
	if (isWindows) {
		// Windows: use robocopy or xcopy
		await execAsync(`xcopy "${source}" "${target}" /E /I /H /Y /Q`)
	} else {
		// Unix: use cp -r
		await execAsync(`cp -r "${source}" "${target}"`)
	}
}

/**
 * Recursively gets all files in a directory (parallelized)
 */
async function getAllFiles(dir: string, baseDir: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		const results = await Promise.all(
			entries.map(async (entry) => {
				const fullPath = path.join(dir, entry.name)
				const relativePath = path.relative(baseDir, fullPath)

				if (entry.isDirectory()) {
					// Skip .git directory
					if (entry.name === ".git") return []
					return getAllFiles(fullPath, baseDir)
				} else {
					return [relativePath]
				}
			}),
		)

		return results.flat()
	} catch {
		// Directory doesn't exist or can't be read
		return []
	}
}

/**
 * Copy files in parallel batches
 */
async function copyFilesInBatches(
	files: string[],
	sourceDir: string,
	targetDir: string,
): Promise<{ copiedCount: number; errors: string[] }> {
	const errors: string[] = []
	let copiedCount = 0

	// Process in batches for controlled parallelism
	for (let i = 0; i < files.length; i += COPY_BATCH_SIZE) {
		const batch = files.slice(i, i + COPY_BATCH_SIZE)

		const results = await Promise.allSettled(
			batch.map(async (file) => {
				const sourcePath = path.join(sourceDir, file)
				const targetPath = path.join(targetDir, file)

				// Create target directory if it doesn't exist
				await fs.mkdir(path.dirname(targetPath), { recursive: true })

				// Copy the file
				await fs.copyFile(sourcePath, targetPath)
				return file
			}),
		)

		for (const result of results) {
			if (result.status === "fulfilled") {
				copiedCount++
			} else {
				errors.push(result.reason?.message || "Unknown error")
			}
		}
	}

	return { copiedCount, errors }
}

/**
 * Copies files matched by .worktreeinclude patterns that are also in .gitignore.
 * Uses optimized strategies for performance:
 * - Native cp -r for entire directories (10-20x faster)
 * - Parallel file copying with batches (5-10x faster)
 *
 * @param sourceDir The source worktree directory (original repo)
 * @param targetDir The target worktree directory (newly created)
 * @returns Object with copied files count and any errors
 */
export async function copyWorktreeIncludeFiles(
	sourceDir: string,
	targetDir: string,
): Promise<{ copiedCount: number; errors: string[] }> {
	const errors: string[] = []
	let copiedCount = 0

	// Read .worktreeinclude file
	const worktreeIncludePath = path.join(sourceDir, ".worktreeinclude")
	const includePatterns = await parseIgnoreFile(worktreeIncludePath)

	if (includePatterns.length === 0) {
		return { copiedCount: 0, errors: [] }
	}

	// Read .gitignore file
	const gitignorePath = path.join(sourceDir, ".gitignore")
	const gitignorePatterns = await parseIgnoreFile(gitignorePath)

	if (gitignorePatterns.length === 0) {
		return { copiedCount: 0, errors: [] }
	}

	// Create ignore matchers
	const includeMatcher = ignore().add(includePatterns)
	const gitignoreMatcher = ignore().add(gitignorePatterns)

	// Separate patterns into directory patterns and file patterns
	const directoryPatterns: string[] = []
	const filePatterns: string[] = []

	for (const pattern of includePatterns) {
		const dirName = await isDirectoryPattern(sourceDir, pattern)
		if (dirName) {
			// Verify the directory is also gitignored
			if (gitignoreMatcher.ignores(dirName) || gitignoreMatcher.ignores(dirName + "/")) {
				directoryPatterns.push(dirName)
			}
		} else {
			filePatterns.push(pattern)
		}
	}

	// Handle directory patterns with native cp -r (fast path)
	for (const dir of directoryPatterns) {
		const sourcePath = path.join(sourceDir, dir)
		const targetPath = path.join(targetDir, dir)

		try {
			await copyDirectoryNative(sourcePath, targetPath)
			// Count files in the copied directory
			const files = await getAllFiles(sourcePath, sourcePath)
			copiedCount += files.length
		} catch (error) {
			errors.push(`Failed to copy directory ${dir}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	// Handle file patterns with parallel copying (if any remain)
	if (filePatterns.length > 0) {
		// Create matcher for just file patterns
		const fileMatcher = ignore().add(filePatterns)

		// Get all files, excluding already-copied directories
		const dirSet = new Set(directoryPatterns)
		const allFiles = await getAllFiles(sourceDir, sourceDir)

		// Filter files that:
		// 1. Are not in already-copied directories
		// 2. Match file patterns
		// 3. Are gitignored
		const filesToCopy = allFiles.filter((file) => {
			// Skip if in an already-copied directory
			const topDir = file.split(path.sep)[0]
			if (dirSet.has(topDir)) return false

			// Must match both file patterns and gitignore
			const isIncluded = fileMatcher.ignores(file) || includeMatcher.ignores(file)
			const isGitignored = gitignoreMatcher.ignores(file)
			return isIncluded && isGitignored
		})

		if (filesToCopy.length > 0) {
			const result = await copyFilesInBatches(filesToCopy, sourceDir, targetDir)
			copiedCount += result.copiedCount
			errors.push(...result.errors)
		}
	}

	return { copiedCount, errors }
}

/**
 * Checks if a .worktreeinclude file exists in the given directory
 */
export async function hasWorktreeInclude(dir: string): Promise<boolean> {
	try {
		await fs.access(path.join(dir, ".worktreeinclude"))
		return true
	} catch {
		return false
	}
}
