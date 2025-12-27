import * as fs from "fs/promises"
import ignore from "ignore"
import * as path from "path"

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
 * Recursively gets all files in a directory
 */
async function getAllFiles(dir: string, baseDir: string): Promise<string[]> {
	const files: string[] = []

	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)
			const relativePath = path.relative(baseDir, fullPath)

			if (entry.isDirectory()) {
				// Skip .git directory
				if (entry.name === ".git") continue
				files.push(...(await getAllFiles(fullPath, baseDir)))
			} else {
				files.push(relativePath)
			}
		}
	} catch {
		// Directory doesn't exist or can't be read
	}

	return files
}

/**
 * Copies files matched by .worktreeinclude patterns that are also in .gitignore
 * Only files that are both matched by .worktreeinclude AND listed in .gitignore are copied.
 * This prevents accidentally duplicating tracked files.
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
		// No .worktreeinclude file or empty, nothing to copy
		return { copiedCount: 0, errors: [] }
	}

	// Read .gitignore file
	const gitignorePath = path.join(sourceDir, ".gitignore")
	const gitignorePatterns = await parseIgnoreFile(gitignorePath)

	if (gitignorePatterns.length === 0) {
		// No .gitignore, can't safely copy anything
		return { copiedCount: 0, errors: [] }
	}

	// Create ignore matchers
	const includeMatcher = ignore().add(includePatterns)
	const gitignoreMatcher = ignore().add(gitignorePatterns)

	// Get all files in source directory
	const allFiles = await getAllFiles(sourceDir, sourceDir)

	// Filter files that match BOTH .worktreeinclude AND .gitignore
	const filesToCopy = allFiles.filter((file) => {
		const isIncluded = includeMatcher.ignores(file)
		const isGitignored = gitignoreMatcher.ignores(file)
		return isIncluded && isGitignored
	})

	// Copy each file
	for (const file of filesToCopy) {
		const sourcePath = path.join(sourceDir, file)
		const targetPath = path.join(targetDir, file)

		try {
			// Create target directory if it doesn't exist
			const targetDirPath = path.dirname(targetPath)
			await fs.mkdir(targetDirPath, { recursive: true })

			// Copy the file
			await fs.copyFile(sourcePath, targetPath)
			copiedCount++
		} catch (error) {
			errors.push(`Failed to copy ${file}: ${error instanceof Error ? error.message : String(error)}`)
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
