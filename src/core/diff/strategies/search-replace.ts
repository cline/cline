import { DiffStrategy, DiffResult } from "../types"
import { addLineNumbers, everyLineHasLineNumbers, stripLineNumbers } from "../../../integrations/misc/extract-text"
import { distance } from "fastest-levenshtein"

const BUFFER_LINES = 20 // Number of extra context lines to show before and after matches

function getSimilarity(original: string, search: string): number {
	if (search === "") {
		return 1
	}

	// Normalize strings by removing extra whitespace but preserve case
	const normalizeStr = (str: string) => str.replace(/\s+/g, " ").trim()

	const normalizedOriginal = normalizeStr(original)
	const normalizedSearch = normalizeStr(search)

	if (normalizedOriginal === normalizedSearch) {
		return 1
	}

	// Calculate Levenshtein distance using fastest-levenshtein's distance function
	const dist = distance(normalizedOriginal, normalizedSearch)

	// Calculate similarity ratio (0 to 1, where 1 is an exact match)
	const maxLength = Math.max(normalizedOriginal.length, normalizedSearch.length)
	return 1 - dist / maxLength
}

export class SearchReplaceDiffStrategy implements DiffStrategy {
	private fuzzyThreshold: number
	private bufferLines: number

	constructor(fuzzyThreshold?: number, bufferLines?: number) {
		// Use provided threshold or default to exact matching (1.0)
		// Note: fuzzyThreshold is inverted in UI (0% = 1.0, 10% = 0.9)
		// so we use it directly here
		this.fuzzyThreshold = fuzzyThreshold ?? 1.0
		this.bufferLines = bufferLines ?? BUFFER_LINES
	}

	getToolDescription(args: { cwd: string; toolOptions?: { [key: string]: string } }): string {
		return `## apply_diff
Description: Request to replace existing code using a search and replace block.
This tool allows for precise, surgical replaces to files by specifying exactly what content to search for and what to replace it with.
The tool will maintain proper indentation and formatting while making changes.
Only a single operation is allowed per tool use.
The SEARCH section must exactly match existing content including whitespace and indentation.
If you're not confident in the exact content to search for, use the read_file tool first to get the exact content.
When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.

Parameters:
- path: (required) The path of the file to modify (relative to the current working directory ${args.cwd})
- diff: (required) The search/replace block defining the changes.
- start_line: (required) The line number where the search block starts.
- end_line: (required) The line number where the search block ends.

Diff format:
\`\`\`
<<<<<<< SEARCH
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`

Example:

Original file:
\`\`\`
1 | def calculate_total(items):
2 |     total = 0
3 |     for item in items:
4 |         total += item
5 |     return total
\`\`\`

Search/Replace content:
\`\`\`
<<<<<<< SEARCH
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE
\`\`\`

Usage:
<apply_diff>
<path>File path here</path>
<diff>
Your search/replace content here
</diff>
<start_line>1</start_line>
<end_line>5</end_line>
</apply_diff>`
	}

	async applyDiff(
		originalContent: string,
		diffContent: string,
		startLine?: number,
		endLine?: number,
	): Promise<DiffResult> {
		// Extract the search and replace blocks
		const match = diffContent.match(/<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE/)
		if (!match) {
			return {
				success: false,
				error: `Invalid diff format - missing required SEARCH/REPLACE sections\n\nDebug Info:\n- Expected Format: <<<<<<< SEARCH\\n[search content]\\n=======\\n[replace content]\\n>>>>>>> REPLACE\n- Tip: Make sure to include both SEARCH and REPLACE sections with correct markers`,
			}
		}

		let [_, searchContent, replaceContent] = match

		// Detect line ending from original content
		const lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n"

		// Strip line numbers from search and replace content if every line starts with a line number
		if (everyLineHasLineNumbers(searchContent) && everyLineHasLineNumbers(replaceContent)) {
			searchContent = stripLineNumbers(searchContent)
			replaceContent = stripLineNumbers(replaceContent)
		}

		// Split content into lines, handling both \n and \r\n
		const searchLines = searchContent === "" ? [] : searchContent.split(/\r?\n/)
		const replaceLines = replaceContent === "" ? [] : replaceContent.split(/\r?\n/)
		const originalLines = originalContent.split(/\r?\n/)

		// Validate that empty search requires start line
		if (searchLines.length === 0 && !startLine) {
			return {
				success: false,
				error: `Empty search content requires start_line to be specified\n\nDebug Info:\n- Empty search content is only valid for insertions at a specific line\n- For insertions, specify the line number where content should be inserted`,
			}
		}

		// Validate that empty search requires same start and end line
		if (searchLines.length === 0 && startLine && endLine && startLine !== endLine) {
			return {
				success: false,
				error: `Empty search content requires start_line and end_line to be the same (got ${startLine}-${endLine})\n\nDebug Info:\n- Empty search content is only valid for insertions at a specific line\n- For insertions, use the same line number for both start_line and end_line`,
			}
		}

		// Initialize search variables
		let matchIndex = -1
		let bestMatchScore = 0
		let bestMatchContent = ""
		const searchChunk = searchLines.join("\n")

		// Determine search bounds
		let searchStartIndex = 0
		let searchEndIndex = originalLines.length

		// Validate and handle line range if provided
		if (startLine && endLine) {
			// Convert to 0-based index
			const exactStartIndex = startLine - 1
			const exactEndIndex = endLine - 1

			if (exactStartIndex < 0 || exactEndIndex > originalLines.length || exactStartIndex > exactEndIndex) {
				return {
					success: false,
					error: `Line range ${startLine}-${endLine} is invalid (file has ${originalLines.length} lines)\n\nDebug Info:\n- Requested Range: lines ${startLine}-${endLine}\n- File Bounds: lines 1-${originalLines.length}`,
				}
			}

			// Try exact match first
			const originalChunk = originalLines.slice(exactStartIndex, exactEndIndex + 1).join("\n")
			const similarity = getSimilarity(originalChunk, searchChunk)
			if (similarity >= this.fuzzyThreshold) {
				matchIndex = exactStartIndex
				bestMatchScore = similarity
				bestMatchContent = originalChunk
			} else {
				// Set bounds for buffered search
				searchStartIndex = Math.max(0, startLine - (this.bufferLines + 1))
				searchEndIndex = Math.min(originalLines.length, endLine + this.bufferLines)
			}
		}

		// If no match found yet, try middle-out search within bounds
		if (matchIndex === -1) {
			const midPoint = Math.floor((searchStartIndex + searchEndIndex) / 2)
			let leftIndex = midPoint
			let rightIndex = midPoint + 1

			// Search outward from the middle within bounds
			while (leftIndex >= searchStartIndex || rightIndex <= searchEndIndex - searchLines.length) {
				// Check left side if still in range
				if (leftIndex >= searchStartIndex) {
					const originalChunk = originalLines.slice(leftIndex, leftIndex + searchLines.length).join("\n")
					const similarity = getSimilarity(originalChunk, searchChunk)
					if (similarity > bestMatchScore) {
						bestMatchScore = similarity
						matchIndex = leftIndex
						bestMatchContent = originalChunk
					}
					leftIndex--
				}

				// Check right side if still in range
				if (rightIndex <= searchEndIndex - searchLines.length) {
					const originalChunk = originalLines.slice(rightIndex, rightIndex + searchLines.length).join("\n")
					const similarity = getSimilarity(originalChunk, searchChunk)
					if (similarity > bestMatchScore) {
						bestMatchScore = similarity
						matchIndex = rightIndex
						bestMatchContent = originalChunk
					}
					rightIndex++
				}
			}
		}

		// Require similarity to meet threshold
		if (matchIndex === -1 || bestMatchScore < this.fuzzyThreshold) {
			const searchChunk = searchLines.join("\n")
			const originalContentSection =
				startLine !== undefined && endLine !== undefined
					? `\n\nOriginal Content:\n${addLineNumbers(
							originalLines
								.slice(
									Math.max(0, startLine - 1 - this.bufferLines),
									Math.min(originalLines.length, endLine + this.bufferLines),
								)
								.join("\n"),
							Math.max(1, startLine - this.bufferLines),
						)}`
					: `\n\nOriginal Content:\n${addLineNumbers(originalLines.join("\n"))}`

			const bestMatchSection = bestMatchContent
				? `\n\nBest Match Found:\n${addLineNumbers(bestMatchContent, matchIndex + 1)}`
				: `\n\nBest Match Found:\n(no match)`

			const lineRange =
				startLine || endLine
					? ` at ${startLine ? `start: ${startLine}` : "start"} to ${endLine ? `end: ${endLine}` : "end"}`
					: ""
			return {
				success: false,
				error: `No sufficiently similar match found${lineRange} (${Math.floor(bestMatchScore * 100)}% similar, needs ${Math.floor(this.fuzzyThreshold * 100)}%)\n\nDebug Info:\n- Similarity Score: ${Math.floor(bestMatchScore * 100)}%\n- Required Threshold: ${Math.floor(this.fuzzyThreshold * 100)}%\n- Search Range: ${startLine && endLine ? `lines ${startLine}-${endLine}` : "start to end"}\n- Tip: Use read_file to get the latest content of the file before attempting the diff again, as the file content may have changed\n\nSearch Content:\n${searchChunk}${bestMatchSection}${originalContentSection}`,
			}
		}

		// Get the matched lines from the original content
		const matchedLines = originalLines.slice(matchIndex, matchIndex + searchLines.length)

		// Get the exact indentation (preserving tabs/spaces) of each line
		const originalIndents = matchedLines.map((line) => {
			const match = line.match(/^[\t ]*/)
			return match ? match[0] : ""
		})

		// Get the exact indentation of each line in the search block
		const searchIndents = searchLines.map((line) => {
			const match = line.match(/^[\t ]*/)
			return match ? match[0] : ""
		})

		// Apply the replacement while preserving exact indentation
		const indentedReplaceLines = replaceLines.map((line, i) => {
			// Get the matched line's exact indentation
			const matchedIndent = originalIndents[0] || ""

			// Get the current line's indentation relative to the search content
			const currentIndentMatch = line.match(/^[\t ]*/)
			const currentIndent = currentIndentMatch ? currentIndentMatch[0] : ""
			const searchBaseIndent = searchIndents[0] || ""

			// Calculate the relative indentation level
			const searchBaseLevel = searchBaseIndent.length
			const currentLevel = currentIndent.length
			const relativeLevel = currentLevel - searchBaseLevel

			// If relative level is negative, remove indentation from matched indent
			// If positive, add to matched indent
			const finalIndent =
				relativeLevel < 0
					? matchedIndent.slice(0, Math.max(0, matchedIndent.length + relativeLevel))
					: matchedIndent + currentIndent.slice(searchBaseLevel)

			return finalIndent + line.trim()
		})

		// Construct the final content
		const beforeMatch = originalLines.slice(0, matchIndex)
		const afterMatch = originalLines.slice(matchIndex + searchLines.length)

		const finalContent = [...beforeMatch, ...indentedReplaceLines, ...afterMatch].join(lineEnding)
		return {
			success: true,
			content: finalContent,
		}
	}
}
