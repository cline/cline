import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as childProcess from "child_process"
import * as readline from "readline"
import { byLengthAsc, Fzf } from "fzf"
import { getBinPath } from "../ripgrep"

async function executeRipgrepForFiles(
	rgPath: string,
	workspacePath: string,
	limit: number = 5000,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	//console.time("rg_process")
	return new Promise((resolve, reject) => {
		const args = [
			"--files",
			"--follow",
			"--hidden",
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

		const fileResults: { path: string; type: "file" | "folder"; label?: string }[] = []
		const dirSet = new Set<string>() // Track unique directory paths
		let count = 0

		rl.on("line", (line) => {
			if (count < limit) {
				try {
					const relativePath = path.relative(workspacePath, line)

					// Add the file itself
					fileResults.push({
						path: relativePath,
						type: "file",
						label: path.basename(relativePath),
					})

					// Extract and store all parent directory paths
					let dirPath = path.dirname(relativePath)
					while (dirPath && dirPath !== "." && dirPath !== "/") {
						dirSet.add(dirPath)
						dirPath = path.dirname(dirPath)
					}

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
			if (errorOutput && fileResults.length === 0) {
				//console.timeEnd("rg_process")
				reject(new Error(`ripgrep process error: ${errorOutput}`))
			} else {
				//console.time("process_dirs")
				// Convert directory set to array of directory objects
				const dirResults = Array.from(dirSet).map((dirPath) => ({
					path: dirPath,
					type: "folder" as const,
					label: path.basename(dirPath),
				}))

				// Combine files and directories and resolve
				const results = [...fileResults, ...dirResults]
				//console.timeEnd("process_dirs")
				//console.timeEnd("rg_process")
				resolve(results)
			}
		})

		rgProcess.on("error", (error) => {
			//console.timeEnd("rg_process")
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
		//console.time("total_search")
		//console.time("get_rg_path")
		const vscodeAppRoot = vscode.env.appRoot
		const rgPath = await getBinPath(vscodeAppRoot)
		//console.timeEnd("get_rg_path")

		if (!rgPath) {
			throw new Error("Could not find ripgrep binary")
		}

		//console.time("rg_file_search")
		// Get all files and directories (from our modified function)
		const allItems = await executeRipgrepForFiles(rgPath, workspacePath, 5000)
		//console.timeEnd("rg_file_search")

		// If no query, just return the top items
		if (!query.trim()) {
			//console.timeEnd("total_search")
			return allItems.slice(0, limit)
		}

		//console.time("prepare_fzf")
		// Create search items for all files AND directories
		const searchItems = allItems.map((item) => ({
			original: item,
			searchStr: `${item.path} ${item.label || ""}`,
		}))

		// Run fzf search on all items
		const fzf = new Fzf(searchItems, {
			selector: (item) => item.searchStr,
			tiebreakers: [byLengthAsc],
			limit: limit,
		})
		//console.timeEnd("prepare_fzf")

		//console.time("fzf_search")
		// Get all matching results from fzf
		const fzfResults = fzf.find(query).map((result) => result.item.original)
		//console.timeEnd("fzf_search")

		//console.time("verify_results")
		// Verify types of the shortest results
		const verifiedResults = await Promise.all(
			fzfResults.map(async (result) => {
				const fullPath = path.join(workspacePath, result.path)
				// Verify if the path exists and is actually a directory
				if (fs.existsSync(fullPath)) {
					const isDirectory = fs.lstatSync(fullPath).isDirectory()
					return {
						...result,
						type: isDirectory ? ("folder" as const) : ("file" as const),
					}
				}
				// If path doesn't exist, keep original type
				return result
			}),
		)

		//console.timeEnd("verify_results")
		//console.timeEnd("total_search")
		return verifiedResults
	} catch (error) {
		//console.timeEnd("total_search")
		console.error("Error in searchWorkspaceFiles:", error)
		return []
	}
}
