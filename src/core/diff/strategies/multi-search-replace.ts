import { DiffStrategy, DiffResult } from "../types"
import { addLineNumbers, everyLineHasLineNumbers, stripLineNumbers } from "../../../integrations/misc/extract-text"
import { distance } from "fastest-levenshtein"
import { ToolProgressStatus } from "../../../shared/ExtensionMessage"
import { ToolUse } from "../../assistant-message"

const BUFFER_LINES = 40 // Number of extra context lines to show before and after matches

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

export class MultiSearchReplaceDiffStrategy implements DiffStrategy {
	private fuzzyThreshold: number
	private bufferLines: number

	getName(): string {
		return "MultiSearchReplace"
	}

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
ALWAYS make as many changes in a single 'apply_diff' request as possible using multiple SEARCH/REPLACE blocks

Parameters:
- path: (required) The path of the file to modify (relative to the current working directory ${args.cwd})
- diff: (required) The search/replace block defining the changes.

Diff format:
\`\`\`
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
:end_line: (required) The line number of original content  where the search block ends.
-------
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
:start_line:1
:end_line:5
-------
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

Search/Replace content with multi edits:
\`\`\`
<<<<<<< SEARCH
:start_line:1
:end_line:2
-------
def calculate_sum(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
:end_line:5
-------
        total += item
    return total
=======
        sum += item
    return sum 
>>>>>>> REPLACE
\`\`\`


Usage:
<apply_diff>
<path>File path here</path>
<diff>
Your search/replace content here
You can use multi search/replace block in one diff block, but make sure to include the line numbers for each block.
Only use a single line of '=======' between search and replacement content, because multiple '=======' will corrupt the file.
</diff>
</apply_diff>`
	}

	private unescapeMarkers(content: string): string {
		return content
			.replace(/^\\<<<<<<< SEARCH/gm, "<<<<<<< SEARCH")
			.replace(/^\\=======/gm, "=======")
			.replace(/^\\>>>>>>> REPLACE/gm, ">>>>>>> REPLACE")
			.replace(/^\\-------/gm, "-------")
			.replace(/^\\:end_line:/gm, ":end_line:")
			.replace(/^\\:start_line:/gm, ":start_line:")
	}

	private validateMarkerSequencing(diffContent: string): { success: boolean; error?: string } {
		enum State {
			START,
			AFTER_SEARCH,
			AFTER_SEPARATOR,
		}
		const state = { current: State.START, line: 0 }

		const SEARCH = "<<<<<<< SEARCH"
		const SEP = "======="
		const REPLACE = ">>>>>>> REPLACE"

		const reportError = (found: string, expected: string) => ({
			success: false,
			error:
				`ERROR: Special marker '${found}' found in your diff content at line ${state.line}:\n` +
				"\n" +
				`When removing merge conflict markers like '${found}' from files, you MUST escape them\n` +
				"in your SEARCH section by prepending a backslash (\\) at the beginning of the line:\n" +
				"\n" +
				"CORRECT FORMAT:\n\n" +
				"<<<<<<< SEARCH\n" +
				"content before\n" +
				`\\${found}    <-- Note the backslash here in this example\n` +
				"content after\n" +
				"=======\n" +
				"replacement content\n" +
				">>>>>>> REPLACE\n" +
				"\n" +
				"Without escaping, the system confuses your content with diff syntax markers.\n" +
				"You may use multiple diff blocks in a single diff request, but ANY of ONLY the following separators that occur within SEARCH or REPLACE content must be escaped, as follows:\n" +
				`\\${SEARCH}\n` +
				`\\${SEP}\n` +
				`\\${REPLACE}\n`,
		})

		for (const line of diffContent.split("\n")) {
			state.line++
			const marker = line.trim()

			switch (state.current) {
				case State.START:
					if (marker === SEP) return reportError(SEP, SEARCH)
					if (marker === REPLACE) return reportError(REPLACE, SEARCH)
					if (marker === SEARCH) state.current = State.AFTER_SEARCH
					break

				case State.AFTER_SEARCH:
					if (marker === SEARCH) return reportError(SEARCH, SEP)
					if (marker === REPLACE) return reportError(REPLACE, SEP)
					if (marker === SEP) state.current = State.AFTER_SEPARATOR
					break

				case State.AFTER_SEPARATOR:
					if (marker === SEARCH) return reportError(SEARCH, REPLACE)
					if (marker === SEP) return reportError(SEP, REPLACE)
					if (marker === REPLACE) state.current = State.START
					break
			}
		}

		return state.current === State.START
			? { success: true }
			: {
					success: false,
					error: `ERROR: Unexpected end of sequence: Expected '${state.current === State.AFTER_SEARCH ? SEP : REPLACE}' was not found.`,
				}
	}

	async applyDiff(
		originalContent: string,
		diffContent: string,
		_paramStartLine?: number,
		_paramEndLine?: number,
	): Promise<DiffResult> {
		const validseq = this.validateMarkerSequencing(diffContent)
		if (!validseq.success) {
			return {
				success: false,
				error: validseq.error!,
			}
		}

		/*
			Regex parts:
			
			1. (?:^|\n)  
			  Ensures the first marker starts at the beginning of the file or right after a newline.

			2. (?<!\\)<<<<<<< SEARCH\s*\n  
			  Matches the line “<<<<<<< SEARCH” (ignoring any trailing spaces) – the negative lookbehind makes sure it isn’t escaped.

			3. ((?:\:start_line:\s*(\d+)\s*\n))?  
			  Optionally matches a “:start_line:” line. The outer capturing group is group 1 and the inner (\d+) is group 2.

			4. ((?:\:end_line:\s*(\d+)\s*\n))?  
			  Optionally matches a “:end_line:” line. Group 3 is the whole match and group 4 is the digits.

			5. ((?<!\\)-------\s*\n)?  
			  Optionally matches the “-------” marker line (group 5).

			6. ([\s\S]*?)(?:\n)?  
			  Non‐greedy match for the “search content” (group 6) up to the next marker.

			7. (?:(?<=\n)(?<!\\)=======\s*\n)  
			  Matches the “=======” marker on its own line.

			8. ([\s\S]*?)(?:\n)?  
			  Non‐greedy match for the “replace content” (group 7).

			9. (?:(?<=\n)(?<!\\)>>>>>>> REPLACE)(?=\n|$)  
			  Matches the final “>>>>>>> REPLACE” marker on its own line (and requires a following newline or the end of file).
		*/

		let matches = [
			...diffContent.matchAll(
				/(?:^|\n)(?<!\\)<<<<<<< SEARCH\s*\n((?:\:start_line:\s*(\d+)\s*\n))?((?:\:end_line:\s*(\d+)\s*\n))?((?<!\\)-------\s*\n)?([\s\S]*?)(?:\n)?(?:(?<=\n)(?<!\\)=======\s*\n)([\s\S]*?)(?:\n)?(?:(?<=\n)(?<!\\)>>>>>>> REPLACE)(?=\n|$)/g,
			),
		]

		if (matches.length === 0) {
			return {
				success: false,
				error: `Invalid diff format - missing required sections\n\nDebug Info:\n- Expected Format: <<<<<<< SEARCH\\n:start_line: start line\\n:end_line: end line\\n-------\\n[search content]\\n=======\\n[replace content]\\n>>>>>>> REPLACE\n- Tip: Make sure to include start_line/end_line/SEARCH/=======/REPLACE sections with correct markers on new lines`,
			}
		}
		// Detect line ending from original content
		const lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n"
		let resultLines = originalContent.split(/\r?\n/)
		let delta = 0
		let diffResults: DiffResult[] = []
		let appliedCount = 0
		const replacements = matches
			.map((match) => ({
				startLine: Number(match[2] ?? 0),
				endLine: Number(match[4] ?? resultLines.length),
				searchContent: match[6],
				replaceContent: match[7],
			}))
			.sort((a, b) => a.startLine - b.startLine)

		for (let { searchContent, replaceContent, startLine, endLine } of replacements) {
			startLine += startLine === 0 ? 0 : delta
			endLine += delta

			// First unescape any escaped markers in the content
			searchContent = this.unescapeMarkers(searchContent)
			replaceContent = this.unescapeMarkers(replaceContent)

			// Strip line numbers from search and replace content if every line starts with a line number
			if (everyLineHasLineNumbers(searchContent) && everyLineHasLineNumbers(replaceContent)) {
				searchContent = stripLineNumbers(searchContent)
				replaceContent = stripLineNumbers(replaceContent)
			}

			// Validate that search and replace content are not identical
			if (searchContent === replaceContent) {
				diffResults.push({
					success: false,
					error:
						`Search and replace content are identical - no changes would be made\n\n` +
						`Debug Info:\n` +
						`- Search and replace must be different to make changes\n` +
						`- Use read_file to verify the content you want to change`,
				})
				continue
			}

			// Split content into lines, handling both \n and \r\n
			const searchLines = searchContent === "" ? [] : searchContent.split(/\r?\n/)
			const replaceLines = replaceContent === "" ? [] : replaceContent.split(/\r?\n/)

			// Validate that empty search requires start line
			if (searchLines.length === 0 && !startLine) {
				diffResults.push({
					success: false,
					error: `Empty search content requires start_line to be specified\n\nDebug Info:\n- Empty search content is only valid for insertions at a specific line\n- For insertions, specify the line number where content should be inserted`,
				})
				continue
			}

			// Validate that empty search requires same start and end line
			if (searchLines.length === 0 && startLine && endLine && startLine !== endLine) {
				diffResults.push({
					success: false,
					error: `Empty search content requires start_line and end_line to be the same (got ${startLine}-${endLine})\n\nDebug Info:\n- Empty search content is only valid for insertions at a specific line\n- For insertions, use the same line number for both start_line and end_line`,
				})
				continue
			}

			// Initialize search variables
			let matchIndex = -1
			let bestMatchScore = 0
			let bestMatchContent = ""
			const searchChunk = searchLines.join("\n")

			// Determine search bounds
			let searchStartIndex = 0
			let searchEndIndex = resultLines.length

			// Validate and handle line range if provided
			if (startLine && endLine) {
				// Convert to 0-based index
				const exactStartIndex = startLine - 1
				const exactEndIndex = endLine - 1

				if (exactStartIndex < 0 || exactEndIndex > resultLines.length || exactStartIndex > exactEndIndex) {
					diffResults.push({
						success: false,
						error: `Line range ${startLine}-${endLine} is invalid (file has ${resultLines.length} lines)\n\nDebug Info:\n- Requested Range: lines ${startLine}-${endLine}\n- File Bounds: lines 1-${resultLines.length}`,
					})
					continue
				}

				// Try exact match first
				const originalChunk = resultLines.slice(exactStartIndex, exactEndIndex + 1).join("\n")
				const similarity = getSimilarity(originalChunk, searchChunk)
				if (similarity >= this.fuzzyThreshold) {
					matchIndex = exactStartIndex
					bestMatchScore = similarity
					bestMatchContent = originalChunk
				} else {
					// Set bounds for buffered search
					searchStartIndex = Math.max(0, startLine - (this.bufferLines + 1))
					searchEndIndex = Math.min(resultLines.length, endLine + this.bufferLines)
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
						const originalChunk = resultLines.slice(leftIndex, leftIndex + searchLines.length).join("\n")
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
						const originalChunk = resultLines.slice(rightIndex, rightIndex + searchLines.length).join("\n")
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
								resultLines
									.slice(
										Math.max(0, startLine - 1 - this.bufferLines),
										Math.min(resultLines.length, endLine + this.bufferLines),
									)
									.join("\n"),
								Math.max(1, startLine - this.bufferLines),
							)}`
						: `\n\nOriginal Content:\n${addLineNumbers(resultLines.join("\n"))}`

				const bestMatchSection = bestMatchContent
					? `\n\nBest Match Found:\n${addLineNumbers(bestMatchContent, matchIndex + 1)}`
					: `\n\nBest Match Found:\n(no match)`

				const lineRange =
					startLine || endLine
						? ` at ${startLine ? `start: ${startLine}` : "start"} to ${endLine ? `end: ${endLine}` : "end"}`
						: ""

				diffResults.push({
					success: false,
					error: `No sufficiently similar match found${lineRange} (${Math.floor(bestMatchScore * 100)}% similar, needs ${Math.floor(this.fuzzyThreshold * 100)}%)\n\nDebug Info:\n- Similarity Score: ${Math.floor(bestMatchScore * 100)}%\n- Required Threshold: ${Math.floor(this.fuzzyThreshold * 100)}%\n- Search Range: ${startLine && endLine ? `lines ${startLine}-${endLine}` : "start to end"}\n- Tip: Use read_file to get the latest content of the file before attempting the diff again, as the file content may have changed\n\nSearch Content:\n${searchChunk}${bestMatchSection}${originalContentSection}`,
				})
				continue
			}

			// Get the matched lines from the original content
			const matchedLines = resultLines.slice(matchIndex, matchIndex + searchLines.length)

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
			const beforeMatch = resultLines.slice(0, matchIndex)
			const afterMatch = resultLines.slice(matchIndex + searchLines.length)
			resultLines = [...beforeMatch, ...indentedReplaceLines, ...afterMatch]
			delta = delta - matchedLines.length + replaceLines.length
			appliedCount++
		}
		const finalContent = resultLines.join(lineEnding)
		if (appliedCount === 0) {
			return {
				success: false,
				failParts: diffResults,
			}
		}
		return {
			success: true,
			content: finalContent,
			failParts: diffResults,
		}
	}

	getProgressStatus(toolUse: ToolUse, result?: DiffResult): ToolProgressStatus {
		const diffContent = toolUse.params.diff
		if (diffContent) {
			const icon = "diff-multiple"
			const searchBlockCount = (diffContent.match(/SEARCH/g) || []).length
			if (toolUse.partial) {
				if (diffContent.length < 1000 || (diffContent.length / 50) % 10 === 0) {
					return { icon, text: `${searchBlockCount}` }
				}
			} else if (result) {
				if (result.failParts?.length) {
					return {
						icon,
						text: `${searchBlockCount - result.failParts.length}/${searchBlockCount}`,
					}
				} else {
					return { icon, text: `${searchBlockCount}` }
				}
			}
		}
		return {}
	}
}
