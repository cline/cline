import { distance } from "fastest-levenshtein"

import { addLineNumbers, everyLineHasLineNumbers, stripLineNumbers } from "../../../integrations/misc/extract-text"
import { ToolProgressStatus } from "../../../shared/ExtensionMessage"
import { ToolUse, DiffStrategy, DiffResult } from "../../../shared/tools"
import { normalizeString } from "../../../utils/text-normalization"

const BUFFER_LINES = 40 // Number of extra context lines to show before and after matches

function getSimilarity(original: string, search: string): number {
	// Empty searches are no longer supported
	if (search === "") {
		return 0
	}

	// Use the normalizeString utility to handle smart quotes and other special characters
	const normalizedOriginal = normalizeString(original)
	const normalizedSearch = normalizeString(search)

	if (normalizedOriginal === normalizedSearch) {
		return 1
	}

	// Calculate Levenshtein distance using fastest-levenshtein's distance function
	const dist = distance(normalizedOriginal, normalizedSearch)

	// Calculate similarity ratio (0 to 1, where 1 is an exact match)
	const maxLength = Math.max(normalizedOriginal.length, normalizedSearch.length)
	return 1 - dist / maxLength
}

/**
 * Performs a "middle-out" search of `lines` (between [startIndex, endIndex]) to find
 * the slice that is most similar to `searchChunk`. Returns the best score, index, and matched text.
 */
function fuzzySearch(lines: string[], searchChunk: string, startIndex: number, endIndex: number) {
	let bestScore = 0
	let bestMatchIndex = -1
	let bestMatchContent = ""
	const searchLen = searchChunk.split(/\r?\n/).length

	// Middle-out from the midpoint
	const midPoint = Math.floor((startIndex + endIndex) / 2)
	let leftIndex = midPoint
	let rightIndex = midPoint + 1

	while (leftIndex >= startIndex || rightIndex <= endIndex - searchLen) {
		if (leftIndex >= startIndex) {
			const originalChunk = lines.slice(leftIndex, leftIndex + searchLen).join("\n")
			const similarity = getSimilarity(originalChunk, searchChunk)
			if (similarity > bestScore) {
				bestScore = similarity
				bestMatchIndex = leftIndex
				bestMatchContent = originalChunk
			}
			leftIndex--
		}

		if (rightIndex <= endIndex - searchLen) {
			const originalChunk = lines.slice(rightIndex, rightIndex + searchLen).join("\n")
			const similarity = getSimilarity(originalChunk, searchChunk)
			if (similarity > bestScore) {
				bestScore = similarity
				bestMatchIndex = rightIndex
				bestMatchContent = originalChunk
			}
			rightIndex++
		}
	}

	return { bestScore, bestMatchIndex, bestMatchContent }
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
- path: (required) The path of the file to modify (relative to the current workspace directory ${args.cwd})
- diff: (required) The search/replace block defining the changes.

Diff format:
\`\`\`
<<<<<<< SEARCH
:start_line: (required) The line number of original content where the search block starts.
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
-------
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
:start_line:4
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
			.replace(/^\\<<<<<<</gm, "<<<<<<<")
			.replace(/^\\=======/gm, "=======")
			.replace(/^\\>>>>>>>/gm, ">>>>>>>")
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
		const SEARCH_PREFIX = "<<<<<<<"
		const REPLACE_PREFIX = ">>>>>>>"

		const reportMergeConflictError = (found: string, _expected: string) => ({
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

		const reportInvalidDiffError = (found: string, expected: string) => ({
			success: false,
			error:
				`ERROR: Diff block is malformed: marker '${found}' found in your diff content at line ${state.line}. Expected: ${expected}\n` +
				"\n" +
				"CORRECT FORMAT:\n\n" +
				"<<<<<<< SEARCH\n" +
				":start_line: (required) The line number of original content where the search block starts.\n" +
				"-------\n" +
				"[exact content to find including whitespace]\n" +
				"=======\n" +
				"[new content to replace with]\n" +
				">>>>>>> REPLACE\n",
		})

		const lines = diffContent.split("\n")
		const searchCount = lines.filter((l) => l.trim() === SEARCH).length
		const sepCount = lines.filter((l) => l.trim() === SEP).length
		const replaceCount = lines.filter((l) => l.trim() === REPLACE).length

		const likelyBadStructure = searchCount !== replaceCount || sepCount < searchCount

		for (const line of diffContent.split("\n")) {
			state.line++
			const marker = line.trim()

			switch (state.current) {
				case State.START:
					if (marker === SEP)
						return likelyBadStructure
							? reportInvalidDiffError(SEP, SEARCH)
							: reportMergeConflictError(SEP, SEARCH)
					if (marker === REPLACE) return reportInvalidDiffError(REPLACE, SEARCH)
					if (marker.startsWith(REPLACE_PREFIX)) return reportMergeConflictError(marker, SEARCH)
					if (marker === SEARCH) state.current = State.AFTER_SEARCH
					else if (marker.startsWith(SEARCH_PREFIX)) return reportMergeConflictError(marker, SEARCH)
					break

				case State.AFTER_SEARCH:
					if (marker === SEARCH) return reportInvalidDiffError(SEARCH, SEP)
					if (marker.startsWith(SEARCH_PREFIX)) return reportMergeConflictError(marker, SEARCH)
					if (marker === REPLACE) return reportInvalidDiffError(REPLACE, SEP)
					if (marker.startsWith(REPLACE_PREFIX)) return reportMergeConflictError(marker, SEARCH)
					if (marker === SEP) state.current = State.AFTER_SEPARATOR
					break

				case State.AFTER_SEPARATOR:
					if (marker === SEARCH) return reportInvalidDiffError(SEARCH, REPLACE)
					if (marker.startsWith(SEARCH_PREFIX)) return reportMergeConflictError(marker, REPLACE)
					if (marker === SEP)
						return likelyBadStructure
							? reportInvalidDiffError(SEP, REPLACE)
							: reportMergeConflictError(SEP, REPLACE)
					if (marker === REPLACE) state.current = State.START
					else if (marker.startsWith(REPLACE_PREFIX)) return reportMergeConflictError(marker, REPLACE)
					break
			}
		}

		return state.current === State.START
			? { success: true }
			: {
					success: false,
					error: `ERROR: Unexpected end of sequence: Expected '${
						state.current === State.AFTER_SEARCH ? "=======" : ">>>>>>> REPLACE"
					}' was not found.`,
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
				error: `Invalid diff format - missing required sections\n\nDebug Info:\n- Expected Format: <<<<<<< SEARCH\\n:start_line: start line\\n-------\\n[search content]\\n=======\\n[replace content]\\n>>>>>>> REPLACE\n- Tip: Make sure to include start_line/SEARCH/=======/REPLACE sections with correct markers on new lines`,
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
				searchContent: match[6],
				replaceContent: match[7],
			}))
			.sort((a, b) => a.startLine - b.startLine)

		for (const replacement of replacements) {
			let { searchContent, replaceContent } = replacement
			let startLine = replacement.startLine + (replacement.startLine === 0 ? 0 : delta)

			// First unescape any escaped markers in the content
			searchContent = this.unescapeMarkers(searchContent)
			replaceContent = this.unescapeMarkers(replaceContent)

			// Strip line numbers from search and replace content if every line starts with a line number
			const hasAllLineNumbers =
				(everyLineHasLineNumbers(searchContent) && everyLineHasLineNumbers(replaceContent)) ||
				(everyLineHasLineNumbers(searchContent) && replaceContent.trim() === "")

			if (hasAllLineNumbers && startLine === 0) {
				startLine = parseInt(searchContent.split("\n")[0].split("|")[0])
			}

			if (hasAllLineNumbers) {
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
			let searchLines = searchContent === "" ? [] : searchContent.split(/\r?\n/)
			let replaceLines = replaceContent === "" ? [] : replaceContent.split(/\r?\n/)

			// Validate that search content is not empty
			if (searchLines.length === 0) {
				diffResults.push({
					success: false,
					error: `Empty search content is not allowed\n\nDebug Info:\n- Search content cannot be empty\n- For insertions, provide a specific line using :start_line: and include content to search for\n- For example, match a single line to insert before/after it`,
				})
				continue
			}

			let endLine = replacement.startLine + searchLines.length - 1

			// Initialize search variables
			let matchIndex = -1
			let bestMatchScore = 0
			let bestMatchContent = ""
			let searchChunk = searchLines.join("\n")

			// Determine search bounds
			let searchStartIndex = 0
			let searchEndIndex = resultLines.length

			// Validate and handle line range if provided
			if (startLine) {
				// Convert to 0-based index
				const exactStartIndex = startLine - 1
				const searchLen = searchLines.length
				const exactEndIndex = exactStartIndex + searchLen - 1

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
					searchEndIndex = Math.min(resultLines.length, startLine + searchLines.length + this.bufferLines)
				}
			}

			// If no match found yet, try middle-out search within bounds
			if (matchIndex === -1) {
				const {
					bestScore,
					bestMatchIndex,
					bestMatchContent: midContent,
				} = fuzzySearch(resultLines, searchChunk, searchStartIndex, searchEndIndex)
				matchIndex = bestMatchIndex
				bestMatchScore = bestScore
				bestMatchContent = midContent
			}

			// Try aggressive line number stripping as a fallback if regular matching fails
			if (matchIndex === -1 || bestMatchScore < this.fuzzyThreshold) {
				// Strip both search and replace content once (simultaneously)
				const aggressiveSearchContent = stripLineNumbers(searchContent, true)
				const aggressiveReplaceContent = stripLineNumbers(replaceContent, true)

				const aggressiveSearchLines = aggressiveSearchContent ? aggressiveSearchContent.split(/\r?\n/) : []
				const aggressiveSearchChunk = aggressiveSearchLines.join("\n")

				// Try middle-out search again with aggressive stripped content (respecting the same search bounds)
				const {
					bestScore,
					bestMatchIndex,
					bestMatchContent: aggContent,
				} = fuzzySearch(resultLines, aggressiveSearchChunk, searchStartIndex, searchEndIndex)
				if (bestMatchIndex !== -1 && bestScore >= this.fuzzyThreshold) {
					matchIndex = bestMatchIndex
					bestMatchScore = bestScore
					bestMatchContent = aggContent
					// Replace the original search/replace with their stripped versions
					searchContent = aggressiveSearchContent
					replaceContent = aggressiveReplaceContent
					searchLines = aggressiveSearchLines
					replaceLines = replaceContent ? replaceContent.split(/\r?\n/) : []
				} else {
					// No match found with either method
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

					const lineRange = startLine ? ` at line: ${startLine}` : ""

					diffResults.push({
						success: false,
						error: `No sufficiently similar match found${lineRange} (${Math.floor(bestMatchScore * 100)}% similar, needs ${Math.floor(this.fuzzyThreshold * 100)}%)\n\nDebug Info:\n- Similarity Score: ${Math.floor(bestMatchScore * 100)}%\n- Required Threshold: ${Math.floor(this.fuzzyThreshold * 100)}%\n- Search Range: ${startLine ? `starting at line ${startLine}` : "start to end"}\n- Tried both standard and aggressive line number stripping\n- Tip: Use the read_file tool to get the latest content of the file before attempting to use the apply_diff tool again, as the file content may have changed\n\nSearch Content:\n${searchChunk}${bestMatchSection}${originalContentSection}`,
					})
					continue
				}
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
			const indentedReplaceLines = replaceLines.map((line) => {
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
			if (toolUse.partial) {
				if (Math.floor(diffContent.length / 10) % 10 === 0) {
					const searchBlockCount = (diffContent.match(/SEARCH/g) || []).length
					return { icon, text: `${searchBlockCount}` }
				}
			} else if (result) {
				const searchBlockCount = (diffContent.match(/SEARCH/g) || []).length
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
