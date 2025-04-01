import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as childProcess from "child_process"
import * as readline from "readline"
import { byLengthAsc, Fzf, FzfResultItem } from "fzf"
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
			"!/.github**",
			"-g",
			"!**/out/**",
			"-g",
			"!**/dist/**",
			"-g",
			"!/__pycache__*/**",
			"-g",
			"!/.venv/**",
			"-g",
			"!/.env/**",
			"-g",
			"!/venv/**",
			"-g",
			"!/env/**",
			"-g",
			"!/.cache/**",
			"-g",
			"!/tmp/**",
			"-g",
			"!/temp/**",
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
				reject(new Error(`ripgrep process error: ${errorOutput}`))
			} else {
				// Convert directory set to array of directory objects
				const dirResults = Array.from(dirSet).map((dirPath) => ({
					path: dirPath,
					type: "folder" as const,
					label: path.basename(dirPath),
				}))

				// Combine files and directories and resolve
				const results = [...fileResults, ...dirResults]
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

		// Get all files and directories (from our modified function)
		const allItems = await executeRipgrepForFiles(rgPath, workspacePath, 5000)

		// If no query, just return the top items
		if (!query.trim()) {
			return allItems.slice(0, limit)
		}

		const searchItems = allItems.map((item) => ({
			original: item,
			// Match Scoring - Prioritize the label (filename) by including it twice in the search string
			searchStr: `${item.label || ""} ${item.label || ""} ${item.path}`,
		}))

		// Run fzf search on all candidates
		const fzf = new Fzf(searchItems, {
			selector: (item) => item.searchStr,
			// Use multiple tiebreakers in order of importance: Match score, then length of match (shorter=better)
			tiebreakers: [OrderbyMatchScore, byLengthAsc],
			limit: limit * 2, // Get more results than needed for filtering, we pick the top half after sort
		})

		const fzfResults = fzf.find(query)

		// The min threshold value will require some testing and tuning as the scores are exponential, and exagerated
		const MIN_SCORE_THRESHOLD = 100

		fzfResults.slice(0, 10).forEach((result, index) => {
			const rawScore = result.score
			const normalizedScore = Math.exp(result.score / 20) // Exponential scaling
		})

		// Filter results by score and map to original items
		const filteredResults = fzfResults
			.filter((result, index) => {
				// Use exponential scaling for normalization
				// This gives a more dramatic difference between good and bad matches
				const normalizedScore = Math.exp(result.score / 20)
				const passes = normalizedScore >= MIN_SCORE_THRESHOLD

				return passes
			})
			.map((result) => result.item.original)
			.slice(0, limit) // Apply the original limit after filtering, removing up to half of the candidates

		//console.log(
		//	`[File Mentions Debug] After filtering: ${filteredResults.length} results passed threshold of ${MIN_SCORE_THRESHOLD}`,
		//)

		const verifiedResults = await Promise.all(
			filteredResults.map(async (result) => {
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

// Custom match scoring for results ordering
// Candidate score tiebreaker - fewer gaps between matched characters scores higher
const OrderbyMatchScore = (a: FzfResultItem<any>, b: FzfResultItem<any>) => {
    const countGaps = (positions: Iterable<number>) => {
        let gaps = 0, prev = -Infinity
        for (const pos of positions) {
            if (prev !== -Infinity && pos - prev > 1) gaps++
            prev = pos
        }
        return gaps
    }

    return countGaps(a.positions) - countGaps(b.positions)
}
