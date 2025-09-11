import { workspaceResolver } from "@core/workspace"
import { arePathsEqual } from "@utils/path"
import { globby, Options } from "globby"
import * as os from "os"
import * as path from "path"

// Constants
const DEFAULT_IGNORE_DIRECTORIES = [
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
	"Pods",
]

// Helper functions
function isRestrictedPath(absolutePath: string): boolean {
	const root = process.platform === "win32" ? path.parse(absolutePath).root : "/"
	const isRoot = arePathsEqual(absolutePath, root)
	if (isRoot) {
		return true
	}

	const homeDir = os.homedir()
	const isHomeDir = arePathsEqual(absolutePath, homeDir)
	if (isHomeDir) {
		return true
	}

	return false
}

function isTargetingHiddenDirectory(absolutePath: string): boolean {
	const dirName = workspaceResolver.getBasename(absolutePath, "Services.glob.isTargetingHiddenDirectory")
	return dirName.startsWith(".")
}

function buildIgnorePatterns(absolutePath: string): string[] {
	const isTargetHidden = isTargetingHiddenDirectory(absolutePath)

	const patterns = [...DEFAULT_IGNORE_DIRECTORIES]

	// Only ignore hidden directories if we're not explicitly targeting a hidden directory
	if (!isTargetHidden) {
		patterns.push(".*")
	}

	return patterns.map((dir) => `**/${dir}/**`)
}

export async function listFiles(dirPath: string, recursive: boolean, limit: number): Promise<[string[], boolean]> {
	const absolutePathResult = workspaceResolver.resolveWorkspacePath(dirPath, "", "Services.glob.listFiles")
	const absolutePath = typeof absolutePathResult === "string" ? absolutePathResult : absolutePathResult.absolutePath

	// Do not allow listing files in root or home directory
	if (isRestrictedPath(absolutePath)) {
		return [[], false]
	}

	const options: Options = {
		cwd: dirPath,
		dot: true, // do not ignore hidden files/directories
		absolute: true,
		markDirectories: true, // Append a / on any directories matched
		gitignore: recursive, // globby ignores any files that are gitignored
		ignore: recursive ? buildIgnorePatterns(absolutePath) : undefined,
		onlyFiles: false, // include directories in results
		suppressErrors: true,
	}

	const filePaths = recursive ? await globbyLevelByLevel(limit, options) : (await globby("*", options)).slice(0, limit)

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
async function globbyLevelByLevel(limit: number, options?: Options) {
	const results: Set<string> = new Set()
	const queue: string[] = ["*"]

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
					// Escape parentheses in the path to prevent glob pattern interpretation
					// This is crucial for NextJS folder naming conventions which use parentheses like (auth), (dashboard)
					// Without escaping, glob treats parentheses as special pattern grouping characters
					const escapedFile = file.replace(/\(/g, "\\(").replace(/\)/g, "\\)")
					queue.push(`${escapedFile}*`)
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
	} catch (_error) {
		console.warn("Globbing timed out, returning partial results")
		return Array.from(results)
	}
}
