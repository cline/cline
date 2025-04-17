import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as childProcess from "child_process"
import * as readline from "readline"
import { getBinPath } from "../ripgrep"
import type { Fzf, FzfResultItem } from "fzf"

// Wrapper function for childProcess.spawn
export type SpawnFunction = typeof childProcess.spawn
export const getSpawnFunction = (): SpawnFunction => childProcess.spawn

export async function executeRipgrepForFiles(
	rgPath: string,
	workspacePath: string,
	limit: number = 5000,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	return new Promise((resolve, reject) => {
		// Arguments for ripgrep to list files, follow symlinks, include hidden, and exclude common directories
		const args = [
			"--files",
			"--follow",
			"--hidden",
			"-g",
			"!**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**",
			workspacePath,
		]

		// Spawn the ripgrep process with the specified arguments
		const rgProcess = getSpawnFunction()(rgPath, args)
		const rl = readline.createInterface({ input: rgProcess.stdout })

		// Array to store file results and Set to track unique directories
		const fileResults: { path: string; type: "file" | "folder"; label?: string }[] = []
		const dirSet = new Set<string>()
		let count = 0

		// Handle each line of output from ripgrep (each line is a file path)
		rl.on("line", (line) => {
			if (count >= limit) {
				rl.close()
				rgProcess.kill()
				return
			}

			// Convert absolute path to a relative path from workspace root
			const relativePath = path.relative(workspacePath, line)

			// Add file result to array
			fileResults.push({
				path: relativePath,
				type: "file",
				label: path.basename(relativePath),
			})

			// Extract and add parent directories to the set
			let dirPath = path.dirname(relativePath)
			while (dirPath && dirPath !== "." && dirPath !== "/") {
				dirSet.add(dirPath)
				dirPath = path.dirname(dirPath)
			}

			count++
		})

		// Capture any error output from ripgrep
		let errorOutput = ""
		rgProcess.stderr.on("data", (data) => (errorOutput += data.toString()))

		// When ripgrep finishes or is closed
		rl.on("close", () => {
			if (errorOutput && fileResults.length === 0) {
				reject(new Error(`ripgrep process error: ${errorOutput.trim()}`))
				return
			}

			// Transform directory paths from Set into structured results
			const dirResults = Array.from(dirSet, (dirPath): { path: string; type: "folder"; label?: string } => ({
				path: dirPath,
				type: "folder",
				label: path.basename(dirPath),
			}))

			// Resolve combined results of files and directories
			resolve([...fileResults, ...dirResults])
		})

		// Handle process-level errors
		rgProcess.on("error", (error) => reject(new Error(`ripgrep process error: ${error.message}`)))
	})
}

export async function searchWorkspaceFiles(
	query: string,
	workspacePath: string,
	limit: number = 20,
): Promise<{ path: string; type: "file" | "folder"; label?: string }[]> {
	try {
		const rgPath = await getBinPath(vscode.env.appRoot)

		if (!rgPath) {
			throw new Error("Could not find ripgrep binary")
		}

		// Get all files and directories
		const allItems = await executeRipgrepForFiles(rgPath, workspacePath, 5000)

		// If no query, just return the top items
		if (!query.trim()) {
			return allItems.slice(0, limit)
		}

		// Match Scoring - Prioritize the label (filename) by including it twice in the search string
		// Use multiple tiebreakers in order of importance: Match score, then length of match (shorter=better)
		// Get more (2x) results than needed for filtering, we pick the top half after sorting
		const fzfModule = await import("fzf")
		const fzf = new fzfModule.Fzf(allItems, {
			selector: (item: { label?: string; path: string }) => `${item.label || ""} ${item.label || ""} ${item.path}`,
			tiebreakers: [OrderbyMatchScore, fzfModule.byLengthAsc],
			limit: limit * 2,
		})

		// The min threshold value will require some testing and tuning as the scores are exponential, and exaggerated
		const MIN_SCORE_THRESHOLD = 100

		// Filter results by score and map to original items
		// Use exponential scaling for normalization
		// This gives a more dramatic difference between good and bad matches
		const filteredResults = fzf
			.find(query)
			.filter(({ score }: { score: number }) => Math.exp(score / 20) >= MIN_SCORE_THRESHOLD)
			.slice(0, limit)

		// Verify if the path exists and is actually a directory
		const verifiedResultsPromises = filteredResults.map(
			async ({ item }: { item: { path: string; type: "file" | "folder"; label?: string } }) => {
				const fullPath = path.join(workspacePath, item.path)
				let type = item.type

				try {
					const stats = await fs.promises.lstat(fullPath)
					type = stats.isDirectory() ? "folder" : "file"
				} catch {
					// Keep original type if path doesn't exist
				}

				return { ...item, type }
			},
		)

		return await Promise.all(verifiedResultsPromises)
	} catch (error) {
		console.error("Error in searchWorkspaceFiles:", error)
		return []
	}
}

// Custom match scoring for results ordering
// Candidate score tiebreaker - fewer gaps between matched characters scores higher
export const OrderbyMatchScore = (a: FzfResultItem<any>, b: FzfResultItem<any>) => {
	const countGaps = (positions: Iterable<number>) => {
		let gaps = 0,
			prev = -Infinity
		for (const pos of positions) {
			if (prev !== -Infinity && pos - prev > 1) {
				gaps++
			}
			prev = pos
		}
		return gaps
	}

	return countGaps(a.positions) - countGaps(b.positions)
}
