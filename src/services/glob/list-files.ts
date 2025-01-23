import os from "os"
import * as path from "path"
import { arePathsEqual } from "../../utils/path"
import { ignoreParser } from "./parse-ignore"

// Define Options type inline to avoid ESM import issues
interface Options {
	cwd?: string
	dot?: boolean
	absolute?: boolean
	markDirectories?: boolean
	gitignore?: boolean
	ignore?: string[]
	onlyFiles?: boolean
}

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

	// Load .clineignore patterns if they exist
	await ignoreParser.loadIgnoreFile(dirPath)
	const clineignorePatterns = ignoreParser.getIgnorePatterns()
	ignoreParser.clear() // Clear patterns after use to prevent interference with future calls

	const options: Options = {
		cwd: dirPath,
		dot: true, // do not ignore hidden files/directories
		absolute: true,
		markDirectories: true, // Append a / on any directories matched (/ is used on windows as well, so dont use path.sep)
		gitignore: recursive, // globby ignores any files that are gitignored
		onlyFiles: false, // true by default, false means it will list directories on their own too
	}

	// * globs all files in one dir, ** globs files in nested directories
	const { globby } = await import("globby")

	if (!recursive) {
		return [(await globby("*", options)).slice(0, limit), false]
	}

	// For recursive listing, handle ignore patterns
	const baseOptions = { ...options, ignore: undefined }

	// Get all files first
	const allFiles = await globby("**", baseOptions)

	// Split patterns into ignore and negated patterns
	const ignorePatterns = [...dirsToIgnore]
	const negatedPatterns: string[] = []

	if (clineignorePatterns.length > 0) {
		clineignorePatterns.forEach((pattern) => {
			if (pattern.startsWith("!")) {
				negatedPatterns.push(pattern.slice(1)) // Remove the ! prefix
			} else {
				ignorePatterns.push(pattern)
			}
		})
	}

	// Get files that match ignore patterns
	const ignoreOptions = { ...baseOptions }
	const ignoredFiles = new Set(await globby(ignorePatterns, ignoreOptions))

	// Get files that match negated patterns (these override ignores)
	const includedFiles = negatedPatterns.length > 0 ? new Set(await globby(negatedPatterns, baseOptions)) : new Set()

	// Filter files:
	// - Keep if it doesn't match any ignore pattern
	// - Or if it matches a negated pattern
	const files = allFiles.filter((file) => !ignoredFiles.has(file) || includedFiles.has(file))

	return [files.slice(0, limit), files.length >= limit]
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
async function globbyLevelByLevel(limit: number, options: Options, globby: any) {
	let results: Set<string> = new Set()
	let queue: string[] = ["*"]

	const globbingProcess = async () => {
		while (queue.length > 0 && results.size < limit) {
			const pattern = queue.shift()!
			const filesAtLevel = await globby(pattern, options)

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
