/**
 * This function reconstructs the file content by applying a streamed diff (in a
 * specialized SEARCH/REPLACE block format) to the original file content. It is designed
 * to handle both incremental updates and the final resulting file after all chunks have
 * been processed.
 *
 * The diff format is a custom structure that uses three markers to define changes:
 *
 *   <<<<<<< SEARCH
 *   [Exact content to find in the original file]
 *   =======
 *   [Content to replace with]
 *   >>>>>>> REPLACE
 *
 * Behavior and Assumptions:
 * 1. The file is processed chunk-by-chunk. Each chunk of `diffContent` may contain
 *    partial or complete SEARCH/REPLACE blocks. By calling this function with each
 *    incremental chunk (with `isFinal` indicating the last chunk), the final reconstructed
 *    file content is produced.
 *
 * 2. Exact Matching with Fallback:
 *    - For each SEARCH block, the exact text must appear in the original file after
 *      `lastProcessedIndex`. If it does, that portion of the original file will be replaced.
 *    - If no exact match is found using a plain `indexOf`, we fall back to a line-by-line
 *      comparison that ignores leading/trailing whitespace. This is useful if the AI-generated
 *      search content differs slightly in indentation or spacing from the original code.
 *    - If neither exact nor trimmed line-based match is found, an error is thrown.
 *
 * 3. Empty SEARCH Section:
 *    - If SEARCH is empty and the original file is empty, this indicates creating a new file
 *      (pure insertion).
 *    - If SEARCH is empty and the original file is not empty, this indicates a complete
 *      file replacement (the entire original content is considered matched and replaced).
 *
 * 4. Applying Changes:
 *    - Before encountering the "=======" marker, lines are accumulated as search content.
 *    - After "=======" and before ">>>>>>> REPLACE", lines are accumulated as replacement content.
 *    - Once the block is complete (">>>>>>> REPLACE"), the matched section in the original
 *      file is replaced with the accumulated replacement lines, and the position in the original
 *      file is advanced.
 *
 * 5. Incremental Output:
 *    - As soon as the match location is found and we are in the REPLACE section, each new
 *      replacement line is appended to the result so that partial updates can be viewed
 *      incrementally.
 *
 * 6. Partial Markers:
 *    - If the final line of the chunk looks like it might be part of a marker but is not one
 *      of the known markers, it is removed. This prevents incomplete or partial markers
 *      from corrupting the output.
 *
 * 7. Finalization:
 *    - Once all chunks have been processed (when `isFinal` is true), any remaining original
 *      content after the last replaced section is appended to the result.
 *    - Trailing newlines are not forcibly added. The code tries to output exactly what is specified.
 *
 * Errors:
 * - If the search block cannot be matched exactly or with the line-trimmed fallback approach,
 *   an error is thrown.
 */

/**
 * Attempts a line-trimmed fallback match for the given search content in the original content.
 * It tries to match `searchContent` lines against a block of lines in `originalContent` starting
 * from `lastProcessedIndex`. Lines are matched by trimming leading/trailing whitespace and ensuring
 * they are identical afterwards.
 *
 * Returns [matchIndexStart, matchIndexEnd] if found, or false if not found.
 */
function lineTrimmedFallbackMatch(
	originalContent: string,
	searchContent: string,
	startIndex: number,
): [number, number] | false {
	const searchLines = searchContent
		.trimEnd()
		.split("\n")
		.map((line) => line.trim())
	if (searchLines.length === 0) {
		// Empty search content fallback doesn't make sense here—should be handled elsewhere
		return false
	}

	const originalAfterIndex = originalContent.slice(startIndex)
	const originalLines = originalAfterIndex.split("\n")

	// We'll try to find a consecutive block of lines in original that matches searchLines when trimmed
	for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
		let allMatch = true
		for (let j = 0; j < searchLines.length; j++) {
			const originalLineTrimmed = originalLines[i + j].trim()
			if (originalLineTrimmed !== searchLines[j]) {
				allMatch = false
				break
			}
		}

		if (allMatch) {
			// Compute the indices in originalContent
			// We know the matched block spans from line i to i+searchLines.length-1 in originalLines
			const preMatchLength = originalLines.slice(0, i).join("\n").length
			const matchStart = startIndex + preMatchLength + (i > 0 ? 1 : 0)
			// Add one char for newline if not the first line

			const matchedBlock = originalLines.slice(i, i + searchLines.length).join("\n")
			const matchEnd = matchStart + matchedBlock.length

			return [matchStart, matchEnd]
		}
	}
	return false
}

export async function constructNewFileContent(
	diffContent: string,
	originalContent: string,
	isFinal: boolean,
): Promise<string> {
	let result = ""
	let lastProcessedIndex = 0

	let currentSearchContent = ""
	let currentReplaceContent = ""
	let inSearch = false
	let inReplace = false

	let searchMatchIndex = -1
	let searchEndIndex = -1

	let lines = diffContent.split("\n")

	// If the last line looks like a partial marker but isn't recognized,
	// remove it because it might be incomplete.
	const lastLine = lines[lines.length - 1]
	if (
		lines.length > 0 &&
		(lastLine.startsWith("<") || lastLine.startsWith("=") || lastLine.startsWith(">")) &&
		lastLine !== "<<<<<<< SEARCH" &&
		lastLine !== "=======" &&
		lastLine !== ">>>>>>> REPLACE"
	) {
		lines.pop()
	}

	for (const line of lines) {
		if (line === "<<<<<<< SEARCH") {
			inSearch = true
			currentSearchContent = ""
			currentReplaceContent = ""
			continue
		}

		if (line === "=======") {
			inSearch = false
			inReplace = true

			if (!currentSearchContent) {
				// Empty search block
				if (originalContent.length === 0) {
					// New file scenario: nothing to match, just start inserting
					searchMatchIndex = 0
					searchEndIndex = 0
				} else {
					// Complete file replacement scenario: treat the entire file as matched
					searchMatchIndex = 0
					searchEndIndex = originalContent.length
				}
			} else {
				// Exact search match scenario
				const exactIndex = originalContent.indexOf(currentSearchContent, lastProcessedIndex)
				if (exactIndex !== -1) {
					searchMatchIndex = exactIndex
					searchEndIndex = exactIndex + currentSearchContent.length
				} else {
					// Attempt fallback line-trimmed matching
					const fallbackMatch = lineTrimmedFallbackMatch(
						originalContent,
						currentSearchContent,
						lastProcessedIndex,
					)
					if (fallbackMatch) {
						;[searchMatchIndex, searchEndIndex] = fallbackMatch
					} else {
						throw new Error(
							`The SEARCH block:\n${currentSearchContent.trimEnd()}\n...does not match anything in the file.`,
						)
					}
				}
			}

			// Output everything up to the match location
			result += originalContent.slice(lastProcessedIndex, searchMatchIndex)
			continue
		}

		if (line === ">>>>>>> REPLACE") {
			// Finished one replace block
			// Advance lastProcessedIndex to after the matched section
			lastProcessedIndex = searchEndIndex

			// Reset for next block
			inSearch = false
			inReplace = false
			currentSearchContent = ""
			currentReplaceContent = ""
			searchMatchIndex = -1
			searchEndIndex = -1
			continue
		}

		// Accumulate content for search or replace
		if (inSearch) {
			currentSearchContent += line + "\n"
		} else if (inReplace) {
			currentReplaceContent += line + "\n"
			// Output replacement lines immediately if we know the insertion point
			if (searchMatchIndex !== -1) {
				result += line + "\n"
			}
		}
	}

	// If this is the final chunk, append any remaining original content
	if (isFinal && lastProcessedIndex < originalContent.length) {
		result += originalContent.slice(lastProcessedIndex)
	}

	return result
}
