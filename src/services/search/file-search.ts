import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as childProcess from "child_process"
import * as readline from "readline"
import { Fzf } from "fzf"
import { getBinPath } from "../ripgrep"

async function executeRipgrepForFiles(
	rgPath: string,
	workspacePath: string,
	limit: number = 5000,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	return new Promise((resolve, reject) => {
		const args = [
			"--files",
			"--follow",
			"-g",
			"!**/node_modules/**",
			"-g",
			"!**/.git/**",
			"-g",
			"!**/out/**",
			"-g",
			"!**/dist/**",
			workspacePath,
		]

		const rgProcess = childProcess.spawn(rgPath, args)
		const rl = readline.createInterface({
			input: rgProcess.stdout,
			crlfDelay: Infinity,
		})

		const results: { path: string; type: "file" | "folder"; label?: string }[] = []
		let count = 0

		rl.on("line", (line) => {
			if (count < limit) {
				try {
					const relativePath = path.relative(workspacePath, line)
					results.push({
						path: relativePath,
						type: "file",
						label: path.basename(relativePath),
					})
					count++
				} catch (error) {
					// Silently ignore errors processing individual paths
				}
			} else {
				rl.close()
				rgProcess.kill()
			}
		})

		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => {
			errorOutput += data.toString()
		})

		rl.on("close", () => {
			if (errorOutput && results.length === 0) {
				reject(new Error(`ripgrep process error: ${errorOutput}`))
			} else {
				resolve(results)
			}
		})

		rgProcess.on("error", (error) => {
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit: number = 20,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	try {
		const vscodeAppRoot = vscode.env.appRoot
		const rgPath = await getBinPath(vscodeAppRoot)

		if (!rgPath) {
			throw new Error("Could not find ripgrep binary")
		}

		const allFiles = await executeRipgrepForFiles(rgPath, workspacePath, 5000)

		if (!query.trim()) {
			return allFiles.slice(0, limit)
		}

		const searchItems = allFiles.map((file) => ({
			original: file,
			searchStr: `${file.path} ${file.label || ""}`,
		}))

		const fzf = new Fzf(searchItems, {
			selector: (item) => item.searchStr,
		})

		const results = fzf
			.find(query)
			.slice(0, limit)
			.map((result) => result.item.original)

		const resultsWithDirectoryCheck = await Promise.all(
			results.map(async (result) => {
				const fullPath = path.join(workspacePath, result.path)
				const isDirectory = fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()

				return {
					...result,
					type: isDirectory ? ("folder" as const) : ("file" as const),
				}
			}),
		)

		return resultsWithDirectoryCheck
	} catch (error) {
		return []
	}
}
