import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as childProcess from "child_process"
import * as readline from "readline"
import { byLengthAsc, Fzf } from "fzf"
import { getBinPath } from "../ripgrep"

interface SearchResult {
	path: string
	type: "file" | "folder"
	label?: string
}

async function* executeRipgrepForFiles(
	rgPath: string,
	workspacePath: string,
	limit: number = 5000,
): AsyncGenerator<SearchResult[], void, unknown> {
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

	const dirMap = new Map<string, boolean>() // Track processed directories
	let count = 0
	let batch: SearchResult[] = []
	const BATCH_SIZE = 20 // Number of results to batch before yielding

	try {
		for await (const line of rl) {
			if (count >= limit) {
				rl.close()
				rgProcess.kill()
				break
			}

			try {
				const relativePath = path.relative(workspacePath, line)

				// Add the file result
				batch.push({
					path: relativePath,
					type: "file",
					label: path.basename(relativePath),
				})

				// Process parent directories
				let dirPath = path.dirname(relativePath)
				while (dirPath && dirPath !== "." && dirPath !== "/") {
					if (!dirMap.has(dirPath)) {
						dirMap.set(dirPath, true)
						batch.push({
							path: dirPath,
							type: "folder",
							label: path.basename(dirPath),
						})
					}
					dirPath = path.dirname(dirPath)
				}

				count++

				// Yield batch when it reaches the batch size
				if (batch.length >= BATCH_SIZE) {
					yield batch
					batch = []
				}
			} catch (error) {
				// Silently ignore errors processing individual paths
				console.error("Error processing path:", error)
			}
		}

		// Yield any remaining results
		if (batch.length > 0) {
			yield batch
		}
	} catch (error) {
		console.error("Error in ripgrep process:", error)
		throw new Error(`ripgrep process error: ${error instanceof Error ? error.message : String(error)}`)
	} finally {
		rl.close()
		rgProcess.kill()
	}
}

export async function* searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit: number = 20,
): AsyncGenerator<SearchResult[], void, unknown> {
	try {
		const vscodeAppRoot = vscode.env.appRoot
		const rgPath = await getBinPath(vscodeAppRoot)

		if (!rgPath) {
			throw new Error("Could not find ripgrep binary")
		}

		let allItems: SearchResult[] = []
		const fzfItems = new Map<string, { original: SearchResult; searchStr: string }>()

		// Stream results from ripgrep
		for await (const batch of executeRipgrepForFiles(rgPath, workspacePath, 5000)) {
			allItems = [...allItems, ...batch]

			// If no query, yield batches directly
			if (!query.trim()) {
				yield batch.slice(0, limit)
				continue
			}

			// Add new items to fzf search map
			for (const item of batch) {
				const searchStr = `${item.path} ${item.label || ""}`
				fzfItems.set(item.path, { original: item, searchStr })
			}

			// Run fzf search on accumulated items
			const fzf = new Fzf(Array.from(fzfItems.values()), {
				selector: (item) => item.searchStr,
				tiebreakers: [byLengthAsc],
				limit: limit,
			})

			// Get matching results
			const fzfResults = fzf.find(query).map((result) => result.item.original)

			// Verify types of results
			const verifiedResults = await Promise.all(
				fzfResults.map(async (result) => {
					const fullPath = path.join(workspacePath, result.path)
					if (fs.existsSync(fullPath)) {
						const isDirectory = fs.lstatSync(fullPath).isDirectory()
						return {
							...result,
							type: isDirectory ? ("folder" as const) : ("file" as const),
						}
					}
					return result
				}),
			)

			yield verifiedResults
		}
	} catch (error) {
		console.error("Error in searchWorkspaceFiles:", error)
		yield []
	}
}
