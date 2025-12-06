import { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"
import * as childProcess from "child_process"
import * as path from "path"
import * as readline from "readline"
import { fileExistsAtPath, getBinaryLocation } from "@/utils/fs"

/*
This file provides functionality to perform regex searches on files using ripgrep.
Inspired by: https://github.com/DiscreteTom/vscode-ripgrep-utils

Key components:
* execRipgrep: Executes the ripgrep command and returns the output.
* regexSearchFiles: The main function that performs regex searches on files.
   - Parameters:
     * cwd: The current working directory (for relative path calculation)
     * directoryPath: The directory to search in
     * regex: The regular expression to search for (Rust regex syntax)
     * filePattern: Optional glob pattern to filter files (default: '*')
   - Returns: A formatted string containing search results with context

The search results include:
- Relative file paths
- 2 lines of context before and after each match
- Matches formatted with pipe characters for easy reading

Usage example:
const results = await regexSearchFiles('/path/to/cwd', '/path/to/search', 'TODO:', '*.ts');

rel/path/to/app.ts
│----
│function processData(data: any) {
│  // Some processing logic here
│  // TODO: Implement error handling
│  return processedData;
│}
│----

rel/path/to/helper.ts
│----
│  let result = 0;
│  for (let i = 0; i < input; i++) {
│    // TODO: Optimize this function for performance
│    result += Math.pow(i, 2);
│  }
│----
*/

interface SearchResult {
	filePath: string
	line: number
	column: number
	match: string
	beforeContext: string[]
	afterContext: string[]
}

const MAX_RESULTS = 300

async function execRipgrep(args: string[]): Promise<string> {
	const binPath: string = await getBinaryLocation("rg")

	return new Promise((resolve, reject) => {
		const rgProcess = childProcess.spawn(binPath, args)
		// cross-platform alternative to head, which is ripgrep author's recommendation for limiting output.
		const rl = readline.createInterface({
			input: rgProcess.stdout,
			crlfDelay: Infinity, // treat \r\n as a single line break even if it's split across chunks. This ensures consistent behavior across different operating systems.
		})

		let output = ""
		let lineCount = 0
		const maxLines = MAX_RESULTS * 5 // limiting ripgrep output with max lines since there's no other way to limit results. it's okay that we're outputting as json, since we're parsing it line by line and ignore anything that's not part of a match. This assumes each result is at most 5 lines.

		rl.on("line", (line) => {
			if (lineCount < maxLines) {
				output += line + "\n"
				lineCount++
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
			if (errorOutput) {
				reject(new Error(`ripgrep process error: ${errorOutput}`))
			} else {
				resolve(output)
			}
		})
		rgProcess.on("error", (error) => {
			reject(new Error(`ripgrep process error: ${error.message}`))
		})
	})
}

/**
 * Finds the git repository root by walking up from the given directory
 * @param startDir - Directory to start searching from
 * @returns Promise<string | null> The git repository root, or null if not found
 */
async function findGitRoot(startDir: string): Promise<string | null> {
	let currentDir = path.resolve(startDir)

	while (currentDir !== path.dirname(currentDir)) {
		// Check if .git exists in current directory
		const gitDir = path.join(currentDir, ".git")
		if (await fileExistsAtPath(gitDir)) {
			return currentDir
		}
		// Move up one directory
		currentDir = path.dirname(currentDir)
	}

	return null
}

/**
 * Checks which files are gitignored using git check-ignore (batch operation)
 * @param filePaths - Array of absolute paths to check
 * @param cwd - Current working directory (may not be git root)
 * @returns Set of file paths that are gitignored (normalized absolute paths)
 */
async function getGitIgnoredFiles(filePaths: string[], cwd: string): Promise<Set<string>> {
	const ignoredFiles = new Set<string>()

	try {
		// Find the git repository root
		const gitRoot = await findGitRoot(cwd)
		if (!gitRoot) {
			return ignoredFiles // Not a git repo, so nothing is gitignored
		}

		// Normalize all file paths and get relative paths from git root
		const normalizedPaths = filePaths.map((p) => path.normalize(p))
		const relativePaths = normalizedPaths
			.map((filePath) => {
				const relative = path.relative(gitRoot, filePath)
				// Filter out paths that are outside the git repo or invalid
				return relative && !relative.startsWith("..") ? relative : null
			})
			.filter((p): p is string => p !== null)

		if (relativePaths.length === 0) {
			return ignoredFiles
		}

		// Use git check-ignore to check all files at once
		// Returns the paths that are ignored
		return new Promise((resolve) => {
			const gitProcess = childProcess.spawn("git", ["check-ignore", "--stdin"], {
				cwd: gitRoot,
				stdio: ["pipe", "pipe", "ignore"],
			})

			let output = ""
			gitProcess.stdout.on("data", (data) => {
				output += data.toString()
			})

			gitProcess.on("close", () => {
				// Each line of output is an ignored file path (relative to git root)
				const ignoredRelativePaths = output
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0)

				// Convert back to normalized absolute paths and add to set
				for (const relativePath of ignoredRelativePaths) {
					const absolutePath = path.normalize(path.resolve(gitRoot, relativePath))
					ignoredFiles.add(absolutePath)
				}

				resolve(ignoredFiles)
			})

			gitProcess.on("error", () => {
				// If git command fails, assume nothing is ignored to be safe
				resolve(ignoredFiles)
			})

			// Write all relative paths to stdin (one per line)
			const input = relativePaths.join("\n") + "\n"
			gitProcess.stdin.write(input)
			gitProcess.stdin.end()
		})
	} catch {
		// If anything fails, assume nothing is ignored to be safe
		return ignoredFiles
	}
}

/**
 * Performs multiple regex searches in a single ripgrep call for better performance.
 * Returns a map of query -> formatted results string.
 */
export async function regexSearchFilesMultiple(
	cwd: string,
	directoryPath: string,
	regexes: string[],
	filePattern?: string,
	clineIgnoreController?: ClineIgnoreController,
): Promise<Map<string, string>> {
	if (regexes.length === 0) {
		return new Map()
	}

	// Build args with multiple -e flags for each pattern
	const args = ["--json"]
	for (const regex of regexes) {
		args.push("-e", regex)
	}
	args.push("--glob", filePattern || "*", "--context", "1", directoryPath)

	let output: string
	try {
		output = await execRipgrep(args)
	} catch (error) {
		throw Error("Error calling ripgrep", { cause: error })
	}

	// Parse results and group by pattern
	const resultsByPattern = new Map<string, SearchResult[]>()
	for (const regex of regexes) {
		resultsByPattern.set(regex, [])
	}

	let currentResult: Partial<SearchResult> | null = null
	let currentPattern: string | null = null

	output.split("\n").forEach((line) => {
		if (line) {
			try {
				const parsed = JSON.parse(line)
				if (parsed.type === "match") {
					if (currentResult && currentPattern) {
						resultsByPattern.get(currentPattern)?.push(currentResult as SearchResult)
					}

					const matchText = parsed.data.lines.text
					// Try to match which pattern this result belongs to
					currentPattern = null
					for (const regex of regexes) {
						try {
							const re = new RegExp(regex)
							if (re.test(matchText)) {
								currentPattern = regex
								break
							}
						} catch {
							// If regex is invalid, skip pattern matching
						}
					}

					currentResult = {
						filePath: parsed.data.path.text,
						line: parsed.data.line_number,
						column: parsed.data.submatches[0].start,
						match: matchText,
						beforeContext: [],
						afterContext: [],
					}
				} else if (parsed.type === "context" && currentResult) {
					if (parsed.data.line_number < currentResult.line!) {
						currentResult.beforeContext!.push(parsed.data.lines.text)
					} else {
						currentResult.afterContext!.push(parsed.data.lines.text)
					}
				}
			} catch (error) {
				console.error("Error parsing ripgrep output:", error)
			}
		}
	})

	if (currentResult && currentPattern) {
		resultsByPattern.get(currentPattern)?.push(currentResult as SearchResult)
	}

	// Batch check which files are gitignored
	const allResults = Array.from(resultsByPattern.values()).flat()
	const filePaths = allResults.map((r) => {
		const filePath = r.filePath
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
		return path.normalize(absolutePath)
	})
	const gitIgnoredFiles = await getGitIgnoredFiles(filePaths, cwd)

	// Filter and format results for each pattern
	const formattedResults = new Map<string, string>()
	for (const [regex, results] of resultsByPattern) {
		const filteredResults = results.filter((result) => {
			const filePath = result.filePath
			const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
			const normalizedPath = path.normalize(absolutePath)

			if (normalizedPath.includes(path.sep + ".git" + path.sep) || normalizedPath.endsWith(path.sep + ".git")) {
				return false
			}

			if (gitIgnoredFiles.has(normalizedPath)) {
				return false
			}

			if (clineIgnoreController && !clineIgnoreController.validateAccess(result.filePath)) {
				return false
			}

			return true
		})

		formattedResults.set(regex, formatResults(filteredResults, cwd))
	}

	return formattedResults
}

export async function regexSearchFiles(
	cwd: string,
	directoryPath: string,
	regex: string,
	filePattern?: string,
	clineIgnoreController?: ClineIgnoreController,
): Promise<string> {
	const args = ["--json", "-e", regex, "--glob", filePattern || "*", "--context", "1", directoryPath]

	let output: string
	try {
		output = await execRipgrep(args)
	} catch (error) {
		throw Error("Error calling ripgrep", { cause: error })
	}
	const results: SearchResult[] = []
	let currentResult: Partial<SearchResult> | null = null

	output.split("\n").forEach((line) => {
		if (line) {
			try {
				const parsed = JSON.parse(line)
				if (parsed.type === "match") {
					if (currentResult) {
						results.push(currentResult as SearchResult)
					}
					currentResult = {
						filePath: parsed.data.path.text,
						line: parsed.data.line_number,
						column: parsed.data.submatches[0].start,
						match: parsed.data.lines.text,
						beforeContext: [],
						afterContext: [],
					}
				} else if (parsed.type === "context" && currentResult) {
					if (parsed.data.line_number < currentResult.line!) {
						currentResult.beforeContext!.push(parsed.data.lines.text)
					} else {
						currentResult.afterContext!.push(parsed.data.lines.text)
					}
				}
			} catch (error) {
				console.error("Error parsing ripgrep output:", error)
			}
		}
	})

	if (currentResult) {
		results.push(currentResult as SearchResult)
	}

	// Batch check which files are gitignored
	// Ensure all paths are absolute and normalized
	const filePaths = results.map((r) => {
		const filePath = r.filePath
		// If path is relative, resolve it relative to cwd; otherwise normalize the absolute path
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
		return path.normalize(absolutePath)
	})
	const gitIgnoredFiles = await getGitIgnoredFiles(filePaths, cwd)

	// Filter results: first by gitignore, then by ClineIgnoreController if provided
	const filteredResults = results.filter((result) => {
		// Ensure path is absolute and normalized (same as in filePaths array)
		const filePath = result.filePath
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
		const normalizedPath = path.normalize(absolutePath)

		// Explicitly exclude .git directory files (git doesn't track these, so they won't be in gitignore)
		if (normalizedPath.includes(path.sep + ".git" + path.sep) || normalizedPath.endsWith(path.sep + ".git")) {
			return false
		}

		// Check if file is gitignored
		if (gitIgnoredFiles.has(normalizedPath)) {
			return false
		}

		// Check ClineIgnoreController if provided (use original path for this check)
		if (clineIgnoreController && !clineIgnoreController.validateAccess(result.filePath)) {
			return false
		}

		return true
	})

	return formatResults(filteredResults, cwd)
}

const MAX_RIPGREP_MB = 0.25
const MAX_BYTE_SIZE = MAX_RIPGREP_MB * 1024 * 1024 // 0./25MB in bytes

function formatResults(results: SearchResult[], cwd: string): string {
	const groupedResults: { [key: string]: SearchResult[] } = {}

	let output = ""
	if (results.length >= MAX_RESULTS) {
		output += `Showing first ${MAX_RESULTS} of ${MAX_RESULTS}+ results. Use a more specific search if necessary.\n\n`
	} else {
		output += `Found ${results.length === 1 ? "1 result" : `${results.length.toLocaleString()} results`}.\n\n`
	}

	// Group results by file name
	results.slice(0, MAX_RESULTS).forEach((result) => {
		const relativeFilePath = path.relative(cwd, result.filePath)
		if (!groupedResults[relativeFilePath]) {
			groupedResults[relativeFilePath] = []
		}
		groupedResults[relativeFilePath].push(result)
	})

	// Track byte size
	let byteSize = Buffer.byteLength(output, "utf8")
	let wasLimitReached = false

	for (const [filePath, fileResults] of Object.entries(groupedResults)) {
		// Check if adding this file's path would exceed the byte limit
		const filePathString = `${filePath.toPosix()}\n│----\n`
		const filePathBytes = Buffer.byteLength(filePathString, "utf8")

		if (byteSize + filePathBytes >= MAX_BYTE_SIZE) {
			wasLimitReached = true
			break
		}

		output += filePathString
		byteSize += filePathBytes

		for (let resultIndex = 0; resultIndex < fileResults.length; resultIndex++) {
			const result = fileResults[resultIndex]
			const allLines = [...result.beforeContext, result.match, ...result.afterContext]

			// Calculate bytes in all lines for this result
			let resultBytes = 0
			const resultLines: string[] = []

			for (const line of allLines) {
				const trimmedLine = line?.trimEnd() ?? ""
				const lineString = `│${trimmedLine}\n`
				const lineBytes = Buffer.byteLength(lineString, "utf8")

				// Check if adding this line would exceed the byte limit
				if (byteSize + resultBytes + lineBytes >= MAX_BYTE_SIZE) {
					wasLimitReached = true
					break
				}

				resultLines.push(lineString)
				resultBytes += lineBytes
			}

			// If we hit the limit in the middle of processing lines, break out of the result loop
			if (wasLimitReached) {
				break
			}

			// Add all lines for this result to the output
			resultLines.forEach((line) => {
				output += line
			})
			byteSize += resultBytes

			// Add separator between results if needed
			if (resultIndex < fileResults.length - 1) {
				const separatorString = "│----\n"
				const separatorBytes = Buffer.byteLength(separatorString, "utf8")

				if (byteSize + separatorBytes >= MAX_BYTE_SIZE) {
					wasLimitReached = true
					break
				}

				output += separatorString
				byteSize += separatorBytes
			}

			// Check if we've hit the byte limit
			if (byteSize >= MAX_BYTE_SIZE) {
				wasLimitReached = true
				break
			}
		}

		// If we hit the limit, break out of the file loop
		if (wasLimitReached) {
			break
		}

		const closingString = "│----\n\n"
		const closingBytes = Buffer.byteLength(closingString, "utf8")

		if (byteSize + closingBytes >= MAX_BYTE_SIZE) {
			wasLimitReached = true
			break
		}

		output += closingString
		byteSize += closingBytes
	}

	// Add a message if we hit the byte limit
	if (wasLimitReached) {
		const truncationMessage = `\n[Results truncated due to exceeding the ${MAX_RIPGREP_MB}MB size limit. Please use a more specific search pattern.]`
		// Only add the message if it fits within the limit
		if (byteSize + Buffer.byteLength(truncationMessage, "utf8") < MAX_BYTE_SIZE) {
			output += truncationMessage
		}
	}

	return output.trim()
}
