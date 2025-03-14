import os from "os"
import * as path from "path"
import { arePathsEqual } from "../../utils/path"
import { readdir } from "fs/promises"

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
		".git",
	]

	const filePaths = await getFilesAndFolders(dirPath, recursive ? dirsToIgnore : [])

	return [filePaths, filePaths.length >= limit]
}

interface FileEntry {
	name: string
	isDirectory(): boolean
	isFile(): boolean
}

async function getFilesAndFolders(dir: string, dirsToIgnore: string[]): Promise<string[]> {
	const files: string[] = []
	const folders: string[] = []

	async function traverse(currentDir: string): Promise<void> {
		const entries: FileEntry[] = await readdir(currentDir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath: string = path.join(currentDir, entry.name)
			const relativePath = path.relative(dir, fullPath)

			if (entry.isDirectory()) {
				const shouldIgnore = dirsToIgnore.some((pattern) => {
					return entry.name === pattern || relativePath.includes(`/${pattern}/`)
				})

				if (!shouldIgnore) {
					folders.push(`${fullPath}/`)
					await traverse(fullPath)
				}
			} else if (entry.isFile()) {
				files.push(fullPath)
			}
		}
	}

	await traverse(dir)
	return [...folders, ...files]
}
