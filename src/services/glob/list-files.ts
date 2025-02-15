import { glob, Options as FGOptions } from "fast-glob"
import ignore from "ignore"
import * as fs from "fs"
import os from "os"
import * as path from "path"
import { arePathsEqual } from "../../utils/path"

export async function listFiles(dirPath: string, recursive: boolean, limit: number): Promise<[string[], boolean]> {
	const absolutePath = path.resolve(dirPath)
	// Do not allow listing files in root or home directory, which cline tends to want to do when the user's prompt is vague.
	const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
	const isRoot = arePathsEqual(absolutePath, root)
	if (isRoot) {
		return [[root], false]
	}
	const homeDir = os.homedir()
	const isHomeDir = arePathsEqual(absolutePath, homeDir)
	if (isHomeDir) {
		return [[homeDir], false]
	}

	const dirsToIgnore = [
		"node_modules",
		"__pycache__",
		"env",
		"venv",
		"target/dependency",
		"build/dependencies",
		"dist",
		"out",
		"bundle",
		"vendor",
		"tmp",
		"temp",
		"deps",
		"pkg",
		"Pods",
		".*", // '!**/.*' excludes hidden directories, while '!**/.*/**' excludes only their contents. This way we are at least aware of the existence of hidden directories.
	].map((dir) => `**/${dir}/**`)

	async function getGitignorePatterns(dirPath: string): Promise<string[]> {
		const gitignorePath = path.join(dirPath, ".gitignore")

		try {
			const gitignoreContent = await fs.promises.readFile(gitignorePath, "utf8")

			// Convert .gitignore patterns to glob patterns
			return gitignoreContent
				.split("\n")
				.filter((line) => line && !line.startsWith("#"))
				.map(
					(pattern) =>
						pattern.startsWith("!")
							? `!**/${pattern.slice(1)}` // Handle negation
							: `**/${pattern}`, // Make patterns recursive
				)
		} catch (error) {
			// If .gitignore doesn't exist or can't be read, return empty array
			return []
		}
	}

	const options: FGOptions = {
		cwd: dirPath,
		dot: true, // do not ignore hidden files/directories
		absolute: true,
		markDirectories: true, // Append a / on any directories matched (/ is used on windows as well, so dont use path.sep)
		onlyFiles: false, // true by default, false means it will list directories on their own too
		ignore: [], // Initialize empty array for ignore patterns
	}

	// Get combined ignore patterns
	const gitignorePatterns = recursive ? await getGitignorePatterns(dirPath) : []
	const ignorePatterns = [...(recursive ? dirsToIgnore : []), ...gitignorePatterns]
	options.ignore = ignorePatterns

	// * globs all files in one dir, ** globs files in nested directories
	const filePaths = recursive ? await globbyLevelByLevel(limit, options) : (await glob("*", options)).slice(0, limit)

	return [filePaths, filePaths.length >= limit]
}

/*
Breadth-first traversal of directory structure level by level up to a limit:
   - Queue-based approach ensures proper breadth-first traversal
   - Processes directory patterns level by level
   - Captures a representative sample of the directory structure up to the limit
   - Minimizes risk of missing deeply nested files

- Notes:
   - Relies on globby to mark directories with /
   - Potential for loops if symbolic links reference back to parent (we could use followSymlinks: false but that may not be ideal for some projects and it's pointless if they're not using symlinks wrong)
   - Timeout mechanism prevents infinite loops
*/
async function globbyLevelByLevel(limit: number, options?: FGOptions) {
	let results: Set<string> = new Set()
	let queue: string[] = ["*"]

	const globbingProcess = async () => {
		while (queue.length > 0 && results.size < limit) {
			const pattern = queue.shift()!
			let filesAtLevel: string[] = []
			try {
				filesAtLevel = await glob(pattern, options)
			} catch (error) {
				// If we get a permission error, log it and continue with other directories
				if (error instanceof Error && error.message.includes("EACCES")) {
					console.warn(`Permission denied accessing: ${pattern}`)
					continue
				}
				throw error // Re-throw any other errors
			}

			for (const file of filesAtLevel) {
				if (results.size >= limit) {
					break
				}
				results.add(file)
				if (file.endsWith("/")) {
					queue.push(`${file}*`)
				}
			}
		}
		return Array.from(results).slice(0, limit)
	}

	// Timeout after 10 seconds and return partial results
	const timeoutPromise = new Promise<string[]>((_, reject) => {
		setTimeout(() => reject(new Error("Globbing timeout")), 10_000)
	})
	try {
		return await Promise.race([globbingProcess(), timeoutPromise])
	} catch (error) {
		console.warn("Globbing timed out, returning partial results")
		return Array.from(results)
	}
}
