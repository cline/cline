"use strict"
Object.defineProperty(exports, "__esModule", { value: true })
exports.constructNewFileContent = constructNewFileContent
exports.handleXmlToolCall = handleXmlToolCall
exports.handleTextEditorTool = handleTextEditorTool
exports.constructNewFileContentV2 = constructNewFileContentV2
/**
 * Attempts a line-trimmed fallback match for the given search content in the original content.
 * It tries to match `searchContent` lines against a block of lines in `originalContent` starting
 * from `lastProcessedIndex`. Lines are matched by trimming leading/trailing whitespace and ensuring
 * they are identical afterwards.
 *
 * Returns [matchIndexStart, matchIndexEnd] if found, or false if not found.
 */
function lineTrimmedFallbackMatch(originalContent, searchContent, startIndex) {
	// Split both contents into lines
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")
	// Trim trailing empty line if exists (from the trailing \n in searchContent)
	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
	}
	// Find the line number where startIndex falls
	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1 // +1 for \n
		startLineNum++
	}
	// For each possible starting position in original content
	for (let i = startLineNum; i <= originalLines.length - searchLines.length; i++) {
		let matches = true
		// Try to match all search lines from this position
		for (let j = 0; j < searchLines.length; j++) {
			const originalTrimmed = originalLines[i + j].trim()
			const searchTrimmed = searchLines[j].trim()
			if (originalTrimmed !== searchTrimmed) {
				matches = false
				break
			}
		}
		// If we found a match, calculate the exact character positions
		if (matches) {
			// Find start character index
			let matchStartIndex = 0
			for (let k = 0; k < i; k++) {
				matchStartIndex += originalLines[k].length + 1 // +1 for \n
			}
			// Find end character index
			let matchEndIndex = matchStartIndex
			for (let k = 0; k < searchLines.length; k++) {
				matchEndIndex += originalLines[i + k].length + 1 // +1 for \n
			}
			return [matchStartIndex, matchEndIndex]
		}
	}
	return false
}
/**
 * Attempts to match blocks of code by using the first and last lines as anchors.
 * This is a third-tier fallback strategy that helps match blocks where we can identify
 * the correct location by matching the beginning and end, even if the exact content
 * differs slightly.
 *
 * The matching strategy:
 * 1. Only attempts to match blocks of 3 or more lines to avoid false positives
 * 2. Extracts from the search content:
 *    - First line as the "start anchor"
 *    - Last line as the "end anchor"
 * 3. For each position in the original content:
 *    - Checks if the next line matches the start anchor
 *    - If it does, jumps ahead by the search block size
 *    - Checks if that line matches the end anchor
 *    - All comparisons are done after trimming whitespace
 *
 * This approach is particularly useful for matching blocks of code where:
 * - The exact content might have minor differences
 * - The beginning and end of the block are distinctive enough to serve as anchors
 * - The overall structure (number of lines) remains the same
 *
 * @param originalContent - The full content of the original file
 * @param searchContent - The content we're trying to find in the original file
 * @param startIndex - The character index in originalContent where to start searching
 * @returns A tuple of [startIndex, endIndex] if a match is found, false otherwise
 */
function blockAnchorFallbackMatch(originalContent, searchContent, startIndex) {
	const originalLines = originalContent.split("\n")
	const searchLines = searchContent.split("\n")
	// Only use this approach for blocks of 3+ lines
	if (searchLines.length < 3) {
		return false
	}
	// Trim trailing empty line if exists
	if (searchLines[searchLines.length - 1] === "") {
		searchLines.pop()
	}
	const firstLineSearch = searchLines[0].trim()
	const lastLineSearch = searchLines[searchLines.length - 1].trim()
	const searchBlockSize = searchLines.length
	// Find the line number where startIndex falls
	let startLineNum = 0
	let currentIndex = 0
	while (currentIndex < startIndex && startLineNum < originalLines.length) {
		currentIndex += originalLines[startLineNum].length + 1
		startLineNum++
	}
	// Look for matching start and end anchors
	for (let i = startLineNum; i <= originalLines.length - searchBlockSize; i++) {
		// Check if first line matches
		if (originalLines[i].trim() !== firstLineSearch) {
			continue
		}
		// Check if last line matches at the expected position
		if (originalLines[i + searchBlockSize - 1].trim() !== lastLineSearch) {
			continue
		}
		// Calculate exact character positions
		let matchStartIndex = 0
		for (let k = 0; k < i; k++) {
			matchStartIndex += originalLines[k].length + 1
		}
		let matchEndIndex = matchStartIndex
		for (let k = 0; k < searchBlockSize; k++) {
			matchEndIndex += originalLines[i + k].length + 1
		}
		return [matchStartIndex, matchEndIndex]
	}
	return false
}
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
 * 2. Matching Strategy (in order of attempt):
 *    a. Exact Match: First attempts to find the exact SEARCH block text in the original file
 *    b. Line-Trimmed Match: Falls back to line-by-line comparison ignoring leading/trailing whitespace
 *    c. Block Anchor Match: For blocks of 3+ lines, tries to match using first/last lines as anchors
 *    If all matching strategies fail, an error is thrown.
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
 * - If the search block cannot be matched using any of the available matching strategies,
 *   an error is thrown.
 */
async function constructNewFileContent(diffContent, originalContent, isFinal, version = "v2") {
	const constructor = constructNewFileContentVersionMapping[version]
	if (!constructor) {
		throw new Error(`Invalid version '${version}' for file content constructor`)
	}
	return constructor(diffContent, originalContent, isFinal)
}
const constructNewFileContentVersionMapping = {
	v1: constructNewFileContentV1,
	v2: constructNewFileContentV2,
}
/**
 * Handles XML-formatted function calls from Claude 4 editor tools
 *
 * @param xmlContent The XML content containing the function call
 * @param originalContent The original content of the file (if applicable)
 * @returns A promise that resolves to the new file content or appropriate response
 */
async function handleXmlToolCall(xmlContent, originalContent) {
	// Extract command type and parameters from XML
	const commandMatch = /<parameter name="command">([^<]+)<\/parameter>/i.exec(xmlContent)
	const idMatch = /<parameter name="id">([^<]+)<\/parameter>/i.exec(xmlContent)
	if (!commandMatch || !idMatch) {
		throw new Error("Invalid XML tool call format: missing command or id parameter")
	}
	const command = commandMatch[1].trim().toLowerCase()
	const id = idMatch[1].trim()
	switch (command) {
		case "update": {
			// Handle replace_in_file equivalent (update)
			if (!originalContent) {
				throw new Error("Cannot perform update on undefined content")
			}
			const oldStrMatch = /<parameter name="old_str">([^]*?)<\/parameter>/i.exec(xmlContent)
			const newStrMatch = /<parameter name="new_str">([^]*?)<\/parameter>/i.exec(xmlContent)
			if (!oldStrMatch) {
				throw new Error("Missing old_str parameter for update command")
			}
			const oldStr = oldStrMatch[1]
			const newStr = newStrMatch ? newStrMatch[1] : ""
			// Create a diff format that constructNewFileContentV2 can process
			const diffContent = `<<<<<<< SEARCH\n${oldStr}\n=======\n${newStr}\n>>>>>>> REPLACE\n`
			return await constructNewFileContentV2(diffContent, originalContent, true)
		}
		case "rewrite": {
			// Handle write_to_file equivalent (rewrite)
			const contentMatch = /<parameter name="content">([^]*?)<\/parameter>/i.exec(xmlContent)
			if (!contentMatch) {
				throw new Error("Missing content parameter for rewrite command")
			}
			// No transformation needed - write_to_file tool will handle this
			return contentMatch[1]
		}
		case "create": {
			// Handle create file
			const contentMatch = /<parameter name="content">([^]*?)<\/parameter>/i.exec(xmlContent)
			if (!contentMatch) {
				throw new Error("Missing content parameter for create command")
			}
			// No transformation needed - write_to_file tool will handle this
			return contentMatch[1]
		}
		default:
			throw new Error(`Unsupported XML command: ${command}`)
	}
}
/**
 * Handles Anthropic text editor tool commands and converts them to appropriate Cline operations.
 * Supports both JSON-based and XML-based tool formats.
 *
 * @param command The command type ("view", "str_replace", "create", "insert") or XML content
 * @param params The parameters for the command (when using JSON format)
 * @param originalContent The original content of the file (if applicable)
 * @returns A promise that resolves to the new file content or appropriate response
 */
async function handleTextEditorTool(command, params, originalContent) {
	// Check if this is an XML-formatted tool call
	if (command.trim().startsWith("<function_calls>") || command.trim().startsWith("<invoke")) {
		return handleXmlToolCall(command, originalContent)
	}
	// Handle JSON-formatted tool calls (original implementation)
	switch (command) {
		case "view":
			// No transformation needed - read_file tool will handle this
			return originalContent || ""
		case "str_replace":
			if (!originalContent) {
				throw new Error("Cannot perform str_replace on undefined content")
			}
			const { old_str, new_str } = params
			// Create a diff format that constructNewFileContentV2 can process
			const diffContent = `<<<<<<< SEARCH\n${old_str}\n=======\n${new_str}\n>>>>>>> REPLACE\n`
			return await constructNewFileContentV2(diffContent, originalContent, true)
		case "create":
			// No transformation needed - write_to_file tool will handle this
			return params.file_text || ""
		case "insert":
			if (!originalContent) {
				throw new Error("Cannot perform insert on undefined content")
			}
			const { insert_line, new_str: insertText } = params
			// Split original content into lines
			const lines = originalContent.split("\n")
			// Insert the new text after the specified line
			if (insert_line === 0) {
				// Insert at the beginning
				return insertText + "\n" + originalContent
			} else if (insert_line >= lines.length) {
				// Insert at the end
				return originalContent + "\n" + insertText
			} else {
				// Insert in the middle
				const before = lines.slice(0, insert_line).join("\n")
				const after = lines.slice(insert_line).join("\n")
				return before + "\n" + insertText + "\n" + after
			}
		default:
			throw new Error(`Unsupported text editor command: ${command}`)
	}
}
/**
 * @deprecated
 */
async function constructNewFileContentV1(diffContent, originalContent, isFinal) {
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
			// Remove trailing linebreak for adding the === marker
			// if (currentSearchContent.endsWith("\r\n")) {
			// 	currentSearchContent = currentSearchContent.slice(0, -2)
			// } else if (currentSearchContent.endsWith("\n")) {
			// 	currentSearchContent = currentSearchContent.slice(0, -1)
			// }
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
				// Add check for inefficient full-file search
				// if (currentSearchContent.trim() === originalContent.trim()) {
				// 	throw new Error(
				// 		"The SEARCH block contains the entire file content. Please either:\n" +
				// 			"1. Use an empty SEARCH block to replace the entire file, or\n" +
				// 			"2. Make focused changes to specific parts of the file that need modification.",
				// 	)
				// }
				// Exact search match scenario
				const exactIndex = originalContent.indexOf(currentSearchContent, lastProcessedIndex)
				if (exactIndex !== -1) {
					searchMatchIndex = exactIndex
					searchEndIndex = exactIndex + currentSearchContent.length
				} else {
					// Attempt fallback line-trimmed matching
					const lineMatch = lineTrimmedFallbackMatch(originalContent, currentSearchContent, lastProcessedIndex)
					if (lineMatch) {
						;[searchMatchIndex, searchEndIndex] = lineMatch
					} else {
						// Try block anchor fallback for larger blocks
						const blockMatch = blockAnchorFallbackMatch(originalContent, currentSearchContent, lastProcessedIndex)
						if (blockMatch) {
							;[searchMatchIndex, searchEndIndex] = blockMatch
						} else {
							throw new Error(
								`The SEARCH block:\n${currentSearchContent.trimEnd()}\n...does not match anything in the file or was searched out of order in the provided blocks.`,
							)
						}
					}
				}
			}
			// Output everything up to the match location
			result += originalContent.slice(lastProcessedIndex, searchMatchIndex)
			continue
		}
		if (line === ">>>>>>> REPLACE") {
			// Finished one replace block
			// // Remove the artificially added linebreak in the last line of the REPLACE block
			// if (result.endsWith("\r\n")) {
			// 	result = result.slice(0, -2)
			// } else if (result.endsWith("\n")) {
			// 	result = result.slice(0, -1)
			// }
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
		// (currentReplaceContent is not being used for anything right now since we directly append to result.)
		// (We artificially add a linebreak since we split on \n at the beginning. In order to not include a trailing linebreak in the final search/result blocks we need to remove it before using them. This allows for partial line matches to be correctly identified.)
		// NOTE: search/replace blocks must be arranged in the order they appear in the file due to how we build the content using lastProcessedIndex. We also cannot strip the trailing newline since for non-partial lines it would remove the linebreak from the original content. (If we remove end linebreak from search, then we'd also have to remove it from replace but we can't know if it's a partial line or not since the model may be using the line break to indicate the end of the block rather than as part of the search content.) We require the model to output full lines in order for our fallbacks to work as well.
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
var ProcessingState
;(function (ProcessingState) {
	ProcessingState[(ProcessingState["Idle"] = 0)] = "Idle"
	ProcessingState[(ProcessingState["StateSearch"] = 1)] = "StateSearch"
	ProcessingState[(ProcessingState["StateReplace"] = 2)] = "StateReplace"
})(ProcessingState || (ProcessingState = {}))
class NewFileContentConstructor {
	constructor(originalContent, isFinal) {
		this.originalContent = originalContent
		this.isFinal = isFinal
		this.pendingNonStandardLines = []
		this.result = ""
		this.lastProcessedIndex = 0
		this.state = ProcessingState.Idle
		this.currentSearchContent = ""
		this.currentReplaceContent = ""
		this.searchMatchIndex = -1
		this.searchEndIndex = -1
	}
	resetForNextBlock() {
		// Reset for next block
		this.state = ProcessingState.Idle
		this.currentSearchContent = ""
		this.currentReplaceContent = ""
		this.searchMatchIndex = -1
		this.searchEndIndex = -1
	}
	findLastMatchingLineIndex(regx, lineLimit) {
		for (let i = lineLimit; i > 0; ) {
			i--
			if (this.pendingNonStandardLines[i].match(regx)) {
				return i
			}
		}
		return -1
	}
	updateProcessingState(newState) {
		const isValidTransition =
			(this.state === ProcessingState.Idle && newState === ProcessingState.StateSearch) ||
			(this.state === ProcessingState.StateSearch && newState === ProcessingState.StateReplace)
		if (!isValidTransition) {
			throw new Error(
				`Invalid state transition.\n` +
					"Valid transitions are:\n" +
					"- Idle → StateSearch\n" +
					"- StateSearch → StateReplace",
			)
		}
		this.state |= newState
	}
	isStateActive(state) {
		return (this.state & state) === state
	}
	activateReplaceState() {
		this.updateProcessingState(ProcessingState.StateReplace)
	}
	activateSearchState() {
		this.updateProcessingState(ProcessingState.StateSearch)
		this.currentSearchContent = ""
		this.currentReplaceContent = ""
	}
	isSearchingActive() {
		return this.isStateActive(ProcessingState.StateSearch)
	}
	isReplacingActive() {
		return this.isStateActive(ProcessingState.StateReplace)
	}
	hasPendingNonStandardLines(pendingNonStandardLineLimit) {
		return this.pendingNonStandardLines.length - pendingNonStandardLineLimit < this.pendingNonStandardLines.length
	}
	processLine(line) {
		this.internalProcessLine(line, true, this.pendingNonStandardLines.length)
	}
	getResult() {
		// If this is the final chunk, append any remaining original content
		if (this.isFinal && this.lastProcessedIndex < this.originalContent.length) {
			this.result += this.originalContent.slice(this.lastProcessedIndex)
		}
		if (this.isFinal && this.state !== ProcessingState.Idle) {
			throw new Error("File processing incomplete - SEARCH/REPLACE operations still active during finalization")
		}
		return this.result
	}
	internalProcessLine(line, canWritependingNonStandardLines, pendingNonStandardLineLimit) {
		let removeLineCount = 0
		if (line === "<<<<<<< SEARCH") {
			removeLineCount = this.trimPendingNonStandardTrailingEmptyLines(pendingNonStandardLineLimit)
			if (removeLineCount > 0) {
				pendingNonStandardLineLimit = pendingNonStandardLineLimit - removeLineCount
			}
			if (this.hasPendingNonStandardLines(pendingNonStandardLineLimit)) {
				this.tryFixSearchReplaceBlock(pendingNonStandardLineLimit)
				canWritependingNonStandardLines && (this.pendingNonStandardLines.length = 0)
			}
			this.activateSearchState()
		} else if (line === "=======") {
			// 校验非标内容
			if (!this.isSearchingActive()) {
				this.tryFixSearchBlock(pendingNonStandardLineLimit)
				canWritependingNonStandardLines && (this.pendingNonStandardLines.length = 0)
			}
			this.activateReplaceState()
			this.beforeReplace()
		} else if (line === ">>>>>>> REPLACE") {
			if (!this.isReplacingActive()) {
				this.tryFixReplaceBlock(pendingNonStandardLineLimit)
				canWritependingNonStandardLines && (this.pendingNonStandardLines.length = 0)
			}
			this.lastProcessedIndex = this.searchEndIndex
			this.resetForNextBlock()
		} else {
			// Accumulate content for search or replace
			// (currentReplaceContent is not being used for anything right now since we directly append to result.)
			// (We artificially add a linebreak since we split on \n at the beginning. In order to not include a trailing linebreak in the final search/result blocks we need to remove it before using them. This allows for partial line matches to be correctly identified.)
			// NOTE: search/replace blocks must be arranged in the order they appear in the file due to how we build the content using lastProcessedIndex. We also cannot strip the trailing newline since for non-partial lines it would remove the linebreak from the original content. (If we remove end linebreak from search, then we'd also have to remove it from replace but we can't know if it's a partial line or not since the model may be using the line break to indicate the end of the block rather than as part of the search content.) We require the model to output full lines in order for our fallbacks to work as well.
			if (this.isReplacingActive()) {
				this.currentReplaceContent += line + "\n"
				// Output replacement lines immediately if we know the insertion point
				if (this.searchMatchIndex !== -1) {
					this.result += line + "\n"
				}
			} else if (this.isSearchingActive()) {
				this.currentSearchContent += line + "\n"
			} else {
				let appendToPendingNonStandardLines = canWritependingNonStandardLines
				if (appendToPendingNonStandardLines) {
					console.log("unstandard line:" + line)
					// 处理非标内容
					this.pendingNonStandardLines.push(line)
				}
			}
		}
		return removeLineCount
	}
	beforeReplace() {
		// Remove trailing linebreak for adding the === marker
		// if (currentSearchContent.endsWith("\r\n")) {
		// 	currentSearchContent = currentSearchContent.slice(0, -2)
		// } else if (currentSearchContent.endsWith("\n")) {
		// 	currentSearchContent = currentSearchContent.slice(0, -1)
		// }
		if (!this.currentSearchContent) {
			// Empty search block
			if (this.originalContent.length === 0) {
				// New file scenario: nothing to match, just start inserting
				this.searchMatchIndex = 0
				this.searchEndIndex = 0
			} else {
				// Complete file replacement scenario: treat the entire file as matched
				this.searchMatchIndex = 0
				this.searchEndIndex = this.originalContent.length
			}
		} else {
			// Add check for inefficient full-file search
			// if (currentSearchContent.trim() === originalContent.trim()) {
			// 	throw new Error(
			// 		"The SEARCH block contains the entire file content. Please either:\n" +
			// 			"1. Use an empty SEARCH block to replace the entire file, or\n" +
			// 			"2. Make focused changes to specific parts of the file that need modification.",
			// 	)
			// }
			// Exact search match scenario
			const exactIndex = this.originalContent.indexOf(this.currentSearchContent, this.lastProcessedIndex)
			if (exactIndex !== -1) {
				this.searchMatchIndex = exactIndex
				this.searchEndIndex = exactIndex + this.currentSearchContent.length
			} else {
				// Attempt fallback line-trimmed matching
				const lineMatch = lineTrimmedFallbackMatch(
					this.originalContent,
					this.currentSearchContent,
					this.lastProcessedIndex,
				)
				if (lineMatch) {
					;[this.searchMatchIndex, this.searchEndIndex] = lineMatch
				} else {
					// Try block anchor fallback for larger blocks
					const blockMatch = blockAnchorFallbackMatch(
						this.originalContent,
						this.currentSearchContent,
						this.lastProcessedIndex,
					)
					if (blockMatch) {
						;[this.searchMatchIndex, this.searchEndIndex] = blockMatch
					} else {
						throw new Error(
							`The SEARCH block:\n${this.currentSearchContent.trimEnd()}\n...does not match anything in the file.`,
						)
					}
				}
			}
		}
		if (this.searchMatchIndex < this.lastProcessedIndex) {
			throw new Error(
				`The SEARCH block:\n${this.currentSearchContent.trimEnd()}\n...matched an incorrect content in the file.`,
			)
		}
		// Output everything up to the match location
		this.result += this.originalContent.slice(this.lastProcessedIndex, this.searchMatchIndex)
	}
	tryFixSearchBlock(lineLimit) {
		let removeLineCount = 0
		if (lineLimit < 0) {
			lineLimit = this.pendingNonStandardLines.length
		}
		if (!lineLimit) {
			throw new Error("Invalid SEARCH/REPLACE block structure - no lines available to process")
		}
		let searchTagRegexp = /^[<]{3,} SEARCH$/
		const searchTagIndex = this.findLastMatchingLineIndex(searchTagRegexp, lineLimit)
		if (searchTagIndex !== -1) {
			let fixLines = this.pendingNonStandardLines.slice(searchTagIndex, lineLimit)
			fixLines[0] = "<<<<<<< SEARCH"
			for (const line of fixLines) {
				removeLineCount += this.internalProcessLine(line, false, searchTagIndex)
			}
		} else {
			throw new Error(
				`Invalid REPLACE marker detected - could not find matching SEARCH block starting from line ${searchTagIndex + 1}`,
			)
		}
		return removeLineCount
	}
	tryFixReplaceBlock(lineLimit) {
		let removeLineCount = 0
		if (lineLimit < 0) {
			lineLimit = this.pendingNonStandardLines.length
		}
		if (!lineLimit) {
			throw new Error()
		}
		let replaceBeginTagRegexp = /^[=]{3,}$/
		const replaceBeginTagIndex = this.findLastMatchingLineIndex(replaceBeginTagRegexp, lineLimit)
		if (replaceBeginTagIndex !== -1) {
			// // 校验非标内容
			// if (!this.isSearchingActive()) {
			// 	removeLineCount += this.tryFixSearchBlock(replaceBeginTagIndex)
			// }
			let fixLines = this.pendingNonStandardLines.slice(replaceBeginTagIndex - removeLineCount, lineLimit - removeLineCount)
			fixLines[0] = "======="
			for (const line of fixLines) {
				removeLineCount += this.internalProcessLine(line, false, replaceBeginTagIndex - removeLineCount)
			}
		} else {
			throw new Error(`Malformed REPLACE block - missing valid separator after line ${replaceBeginTagIndex + 1}`)
		}
		return removeLineCount
	}
	tryFixSearchReplaceBlock(lineLimit) {
		let removeLineCount = 0
		if (lineLimit < 0) {
			lineLimit = this.pendingNonStandardLines.length
		}
		if (!lineLimit) {
			throw new Error()
		}
		let replaceEndTagRegexp = /^[>]{3,} REPLACE$/
		const replaceEndTagIndex = this.findLastMatchingLineIndex(replaceEndTagRegexp, lineLimit)
		const likeReplaceEndTag = replaceEndTagIndex === lineLimit - 1
		if (likeReplaceEndTag) {
			// // 校验非标内容
			// if (!this.isReplacingActive()) {
			// 	removeLineCount += this.tryFixReplaceBlock(replaceEndTagIndex)
			// }
			let fixLines = this.pendingNonStandardLines.slice(replaceEndTagIndex - removeLineCount, lineLimit - removeLineCount)
			fixLines[fixLines.length - 1] = ">>>>>>> REPLACE"
			for (const line of fixLines) {
				removeLineCount += this.internalProcessLine(line, false, replaceEndTagIndex - removeLineCount)
			}
		} else {
			throw new Error("Malformed SEARCH/REPLACE block structure: Missing valid closing REPLACE marker")
		}
		return removeLineCount
	}
	/**
	 * Removes trailing empty lines from the pendingNonStandardLines array
	 * @param lineLimit - The index to start checking from (exclusive).
	 *                    Removes empty lines from lineLimit-1 backwards.
	 * @returns The number of empty lines removed
	 */
	trimPendingNonStandardTrailingEmptyLines(lineLimit) {
		let removedCount = 0
		let i = Math.min(lineLimit, this.pendingNonStandardLines.length) - 1
		while (i >= 0 && this.pendingNonStandardLines[i].trim() === "") {
			this.pendingNonStandardLines.pop()
			removedCount++
			i--
		}
		return removedCount
	}
}
async function constructNewFileContentV2(diffContent, originalContent, isFinal) {
	let newFileContentConstructor = new NewFileContentConstructor(originalContent, isFinal)
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
		newFileContentConstructor.processLine(line)
	}
	let result = newFileContentConstructor.getResult()
	return result
}
