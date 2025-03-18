import { globby, Options } from "globby"
import os from "os"
import * as path from "path"
import { arePathsEqual } from "../../utils/path"
import * as vscode from "vscode"

export async function listFiles(dirPath: string | vscode.Uri, recursive: boolean, limit: number): Promise<[string[], boolean]> {
	if (vscode.workspace.workspaceFolders?.some((v) => v.uri.scheme !== "file")) {
		return listVFiles(dirPath, recursive, limit)
	}
	dirPath = dirPath instanceof vscode.Uri ? dirPath.fsPath : dirPath
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

	const options: Options = {
		cwd: dirPath,
		dot: true, // do not ignore hidden files/directories
		absolute: true,
		markDirectories: true, // Append a / on any directories matched (/ is used on windows as well, so dont use path.sep)
		gitignore: recursive, // globby ignores any files that are gitignored
		ignore: recursive ? dirsToIgnore : undefined, // just in case there is no gitignore, we ignore sensible defaults
		onlyFiles: false, // true by default, false means it will list directories on their own too
		suppressErrors: true,
	}

	// * globs all files in one dir, ** globs files in nested directories
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

export async function listVFiles(dirPath: string | vscode.Uri, recursive: boolean, limit: number): Promise<[string[], boolean]> {
	let dirUri = dirPath instanceof vscode.Uri ? dirPath : vscode.Uri.parse(dirPath)
	const workspace = vscode.workspace.workspaceFolders?.map((v) => v.uri).at(0)
	let dirsToIgnore = [
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
		".*",
	]
	if (recursive) {
		dirsToIgnore.push(".*")
		if (workspace) {
			const gitignore = vscode.Uri.joinPath(workspace, ".gitignore")
			try {
				let igores = new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(gitignore)).split("\n")
				igores = igores.map((v) => v.trim()).filter((v) => v && !v.startsWith("#"))
				dirsToIgnore.push(...igores)
			} catch (e) {}
		}
	}

	let globPatternPix = ""
	if (workspace) {
		globPatternPix = path.relative(workspace.fsPath, dirUri.fsPath)
	}
	const globPattern = globPatternPix + (recursive ? "**/*" : "*")

	const files = await vscode.workspace.findFiles(`${globPattern}`, `{${dirsToIgnore.join(",")}}`, limit)

	const filePaths = files
		.map((f) => {
			const isDirectory = f.fsPath.endsWith(path.sep)
			return isDirectory ? `${f.fsPath}${path.sep}` : f.fsPath
		})
		.slice(0, limit)

	return [filePaths, filePaths.length >= limit]
}
