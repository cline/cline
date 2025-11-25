import { ClineStorageMessage } from "@/shared/messages/content"

const APPLY_PATCH_PATCH_REGEX = /\*\*\* Begin Patch\s+([\s\S]*?)\s+\*\*\* End Patch/m

/**
 * Convert apply_patch tool calls to write_to_file and replace_in_file format
 */
export function convertApplyPatchToolCalls(messages: Array<ClineStorageMessage>): Array<ClineStorageMessage> {
	// Map to track tool_use_id to converted tool info and original input
	const toolUseIdMap = new Map<string, { name: string; input: any; originalInput: any }>()

	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message
		}

		const convertedContent = message.content.map((block) => {
			// Handle tool_use blocks
			if (block.type === "tool_use" && block.name === "apply_patch") {
				const converted = convertApplyPatchToToolCalls(block.input)
				// Store the conversion with original input for matching tool_result
				toolUseIdMap.set(block.id, { ...converted, originalInput: block.input })

				return {
					...block,
					name: converted.name,
					input: converted.input,
				}
			}

			// Handle tool_result blocks
			if (block.type === "tool_result") {
				const conversion = toolUseIdMap.get(block.tool_use_id)
				if (conversion) {
					// Reconstruct the tool_result content to match apply_patch format
					const reconstructedContent = reconstructApplyPatchResult(
						block,
						conversion.name,
						conversion.input,
						conversion.originalInput,
					)
					return {
						...block,
						content: reconstructedContent,
					}
				}
			}

			return block
		})

		return {
			...message,
			content: convertedContent,
		}
	})
}

interface ConvertedTool {
	name: string
	input: any
}

/**
 * Parse apply_patch input and convert to write_to_file or replace_in_file format
 */
function convertApplyPatchToToolCalls(input: any): ConvertedTool {
	const patchInput = typeof input === "string" ? input : input?.input || ""

	// Parse the patch format
	const patchMatch = patchInput.match(APPLY_PATCH_PATCH_REGEX)
	if (!patchMatch) {
		// If we can't parse it, return as-is with write_to_file
		return {
			name: "write_to_file",
			input: input,
		}
	}

	const patchContent = patchMatch[1]

	// Extract file operation (Add, Update, or Delete)
	const fileMatch = patchContent.match(/\*\*\* (Add|Update|Delete) File: (.+?)(?:\n|$)/m)
	if (!fileMatch) {
		return {
			name: "write_to_file",
			input: input,
		}
	}

	const action = fileMatch[1]
	const filePath = fileMatch[2].trim()

	// If it's an Add operation, convert to write_to_file
	if (action === "Add") {
		// Extract the content after the file line
		const contentAfterFile = patchContent.substring(fileMatch.index! + fileMatch[0].length)
		return {
			name: "write_to_file",
			input: {
				absolutePath: filePath,
				content: extractNewContentFromPatch(contentAfterFile),
			},
		}
	}

	// If it's Update or Delete, convert to replace_in_file
	if (action === "Update" || action === "Delete") {
		const diff = convertPatchToDiff(patchContent.substring(fileMatch.index! + fileMatch[0].length))
		return {
			name: "replace_in_file",
			input: {
				absolutePath: filePath,
				diff: diff,
			},
		}
	}

	// Fallback
	return {
		name: "write_to_file",
		input: input,
	}
}

/**
 * Extract new content from add operation patch
 */
function extractNewContentFromPatch(patchContent: string): string {
	// For Add operations, the patch should contain lines starting with +
	const lines = patchContent.split("\n")
	const contentLines: string[] = []

	for (const line of lines) {
		if (line.startsWith("+")) {
			// Remove the + prefix and exactly ONE space if present (but not if it's a tab)
			let content = line.substring(1)
			if (content.startsWith(" ") && !content.startsWith("\t")) {
				content = content.substring(1)
			}
			contentLines.push(content)
		}
	}

	return contentLines.join("\n")
}

/**
 * Convert V4A patch format to SEARCH/REPLACE format
 */
function convertPatchToDiff(patchContent: string): string {
	const diffBlocks: string[] = []
	const lines = patchContent.split("\n")

	let i = 0
	while (i < lines.length) {
		const line = lines[i]

		// Skip empty lines at the start
		if (!line.trim() && i === 0) {
			i++
			continue
		}

		// Check if this is the start of a hunk (@@) or a direct change line
		if (line.trim().startsWith("@@") || line.startsWith("-") || line.startsWith("+")) {
			const currentSearch: string[] = []
			const currentReplace: string[] = []

			// Collect @@ context marker lines
			// @@ prefix marks context lines. If @@something, then "something" is context.
			// If just @@, then it's an empty context line.
			while (i < lines.length && lines[i].trim().startsWith("@@")) {
				const trimmedLine = lines[i].trim()
				// Extract the actual context content after @@
				const contextLine = trimmedLine.substring(2)
				// Always add the context line (even if empty)
				currentSearch.push(contextLine)
				currentReplace.push(contextLine)
				i++
			}

			if (i >= lines.length) {
				break
			}

			// Collect all remaining lines in this hunk until we hit end of content or next @@
			const hunkLines: string[] = []
			while (i < lines.length) {
				// Check if this is a new hunk (starts with @@)
				if (lines[i].trim().startsWith("@@")) {
					break
				}
				hunkLines.push(lines[i])
				i++
			}

			// Now process the hunk to build SEARCH/REPLACE
			let hasChanges = false
			for (let j = 0; j < hunkLines.length; j++) {
				const hunkLine = hunkLines[j]

				if (hunkLine.startsWith("-")) {
					hasChanges = true
					// Strip the - prefix and exactly ONE space if present (but not if it's a tab)
					let content = hunkLine.substring(1)
					if (content.startsWith(" ") && !content.startsWith(" \t")) {
						content = content.substring(1)
					}
					currentSearch.push(content)
				} else if (hunkLine.startsWith("+")) {
					hasChanges = true
					// Strip the + prefix and exactly ONE space if present (but not if it's a tab)
					let content = hunkLine.substring(1)
					if (content.startsWith(" ") && !content.startsWith(" \t")) {
						content = content.substring(1)
					}
					currentReplace.push(content)
				} else {
					// Context line without @@ prefix - add to both sides
					currentSearch.push(hunkLine)
					currentReplace.push(hunkLine)
				}
			}

			// Create the diff block if we have changes
			if (hasChanges && (currentSearch.length > 0 || currentReplace.length > 0)) {
				diffBlocks.push(
					"------- SEARCH\n" +
						currentSearch.join("\n") +
						"\n=======\n" +
						currentReplace.join("\n") +
						"\n+++++++ REPLACE",
				)
			}
		} else {
			i++
		}
	}

	return diffBlocks.join("\n")
}

/**
 * Reconstruct tool_result content to match apply_patch format by extracting
 * the final file content and converting it back to V4A patch format
 */
function reconstructApplyPatchResult(
	block: any,
	convertedToolName: string,
	_convertedInput: any,
	originalInput: any,
): string | any[] {
	// Extract the content from the tool_result
	const content = typeof block.content === "string" ? block.content : ""

	// Try to extract the final_file_content
	const finalContentMatch = content.match(/<final_file_content path="([^"]+)">\s*([\s\S]*?)\s*<\/final_file_content>/)

	if (!finalContentMatch) {
		// If no final_file_content found, return original content
		return block.content
	}

	const filePath = finalContentMatch[1]
	const finalContent = finalContentMatch[2]

	// Reconstruct the result message based on the converted tool type
	if (convertedToolName === "write_to_file") {
		// For write_to_file, we just need to confirm the file was created/written
		return `[apply_patch for '${filePath}'] Result:\nThe content was successfully saved to ${filePath}.\n\nThe file has been created/updated with the new content.`
	}

	if (convertedToolName === "replace_in_file") {
		// For replace_in_file, we need to reconstruct the V4A patch format result
		// Try to parse the original patch to get the action and build context
		const patchInput = typeof originalInput === "string" ? originalInput : originalInput?.input || ""
		const patchMatch = patchInput.match(APPLY_PATCH_PATCH_REGEX)

		if (patchMatch) {
			const patchContent = patchMatch[1]
			const fileMatch = patchContent.match(/\*\*\* (Add|Update|Delete) File: (.+?)(?:\n|$)/m)

			if (fileMatch) {
				const action = fileMatch[1]
				return `[apply_patch for '${filePath}'] Result:\nThe content was successfully updated in ${filePath}.\n\nThe file has been modified using ${action} operation.\n\n<final_file_content path="${filePath}">\n${finalContent}\n</final_file_content>\n\nIMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference.`
			}
		}

		// Fallback for replace_in_file
		return `[apply_patch for '${filePath}'] Result:\nThe content was successfully updated in ${filePath}.\n\n<final_file_content path="${filePath}">\n${finalContent}\n</final_file_content>\n\nIMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference.`
	}

	// Default fallback
	return block.content
}

/**
 * Convert write_to_file and replace_in_file tool calls to apply_patch format
 */
export function convertWriteToFileToolCalls(messages: Array<ClineStorageMessage>): Array<ClineStorageMessage> {
	// Map to track tool_use_id to converted tool info and original input
	const toolUseIdMap = new Map<string, { originalName: string; originalInput: any; patchInput?: string }>()

	// First pass: collect tool_use blocks
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue
		}
		for (const block of message.content) {
			if (block.type === "tool_use" && (block.name === "write_to_file" || block.name === "replace_in_file")) {
				toolUseIdMap.set(block.id, {
					originalName: block.name,
					originalInput: block.input,
				})
			}
		}
	}

	// Second pass: find tool_results and extract final content to build proper patches
	const finalContentMap = new Map<string, string>()
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue
		}
		for (const block of message.content) {
			if (block.type === "tool_result" && toolUseIdMap.has(block.tool_use_id)) {
				const content = typeof block.content === "string" ? block.content : ""
				const finalContentMatch = content.match(
					/<final_file_content path="([^"]+)">\s*([\s\S]*?)\s*<\/final_file_content>/,
				)
				if (finalContentMatch) {
					finalContentMap.set(block.tool_use_id, finalContentMatch[2])
				}
			}
		}
	}

	// Third pass: convert messages
	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message
		}

		const convertedContent = message.content.map((block) => {
			// Handle tool_use blocks for write_to_file and replace_in_file
			if (block.type === "tool_use" && (block.name === "write_to_file" || block.name === "replace_in_file")) {
				const finalContent = finalContentMap.get(block.id)
				const patchInput = convertToPatchFormat(block.name, block.input, finalContent)

				// Update the map with the generated patch
				const existingEntry = toolUseIdMap.get(block.id)
				if (existingEntry) {
					existingEntry.patchInput = patchInput
				}

				return {
					...block,
					name: "apply_patch",
					input: {
						input: patchInput,
					},
				}
			}

			// Handle tool_result blocks
			if (block.type === "tool_result") {
				const conversion = toolUseIdMap.get(block.tool_use_id)
				if (conversion) {
					// Reconstruct the tool_result content to match apply_patch format
					const reconstructedContent = reconstructWriteToFileResult(
						block,
						conversion.originalName,
						conversion.originalInput,
					)
					return {
						...block,
						content: reconstructedContent,
					}
				}
			}

			return block
		})

		return {
			...message,
			content: convertedContent,
		}
	})
}

/**
 * Convert write_to_file or replace_in_file input to apply_patch format
 */
function convertToPatchFormat(toolName: string, input: any, finalContent?: string): string {
	const filePath = input.absolutePath || input.path || ""

	if (toolName === "write_to_file") {
		// Convert write_to_file to Add operation
		const content = input.content || ""
		const lines = content.split("\n")
		const patchLines = ["@@"]
		patchLines.push(...lines.map((line: string) => `+ ${line}`))

		return `apply_patch <<"EOF"
*** Begin Patch
*** Add File: ${filePath}
${patchLines.join("\n")}
*** End Patch
EOF`
	}

	if (toolName === "replace_in_file") {
		// Convert replace_in_file to Update operation
		const diff = input.diff || ""

		// Parse SEARCH/REPLACE blocks and convert to V4A format with context
		const patchContent = convertDiffToPatchWithContext(diff, finalContent)

		return `apply_patch <<"EOF"
*** Begin Patch
*** Update File: ${filePath}
${patchContent}
*** End Patch
EOF`
	}

	return ""
}

/**
 * Convert SEARCH/REPLACE diff format to V4A patch format with additional context from final content
 */
function convertDiffToPatchWithContext(diff: string, finalContent?: string): string {
	const patchLines: string[] = []

	// Match all SEARCH/REPLACE blocks
	const blockRegex = /------- SEARCH\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n\+{7} REPLACE/g
	let match

	while ((match = blockRegex.exec(diff)) !== null) {
		const searchContent = match[1]
		const replaceContent = match[2]

		const searchLines = searchContent.split("\n")
		const replaceLines = replaceContent.split("\n")

		// Find common prefix and suffix between search and replace
		let prefixEnd = 0
		while (
			prefixEnd < searchLines.length &&
			prefixEnd < replaceLines.length &&
			searchLines[prefixEnd] === replaceLines[prefixEnd]
		) {
			prefixEnd++
		}

		let suffixStart = searchLines.length
		let replaceSuffixStart = replaceLines.length
		while (
			suffixStart > prefixEnd &&
			replaceSuffixStart > prefixEnd &&
			searchLines[suffixStart - 1] === replaceLines[replaceSuffixStart - 1]
		) {
			suffixStart--
			replaceSuffixStart--
		}

		// If we have finalContent, extract additional context from it
		if (finalContent) {
			const finalLines = finalContent.split("\n")

			// Find where the replaced content appears in the final file
			let matchIndex = -1
			for (let i = 0; i < finalLines.length; i++) {
				// Try to match the first replace line
				if (replaceLines.length > 0 && finalLines[i] === replaceLines[0]) {
					// Check if subsequent lines also match
					let allMatch = true
					for (let j = 1; j < replaceLines.length && i + j < finalLines.length; j++) {
						if (finalLines[i + j] !== replaceLines[j]) {
							allMatch = false
							break
						}
					}
					if (allMatch) {
						matchIndex = i
						break
					}
				}
			}

			if (matchIndex >= 0) {
				// Extract up to 3 lines before as context
				const contextStart = Math.max(0, matchIndex - 3)
				const contextLines: string[] = []
				for (let i = contextStart; i < matchIndex; i++) {
					contextLines.push(finalLines[i])
				}

				// Pad to 3 lines if needed (with empty strings)
				while (contextLines.length < 3) {
					contextLines.unshift("")
				}

				// Add @@ marker with the first context line
				if (contextLines[0] === "") {
					patchLines.push("@@")
				} else {
					patchLines.push(`@@${contextLines[0]}`)
				}

				// Add remaining context lines (without @@ marker)
				for (let i = 1; i < contextLines.length; i++) {
					patchLines.push(contextLines[i])
				}

				// Add common prefix lines (without +/- markers)
				for (let i = 0; i < prefixEnd; i++) {
					patchLines.push(searchLines[i])
				}

				// Add the actual changes (lines that differ)
				for (let i = prefixEnd; i < suffixStart; i++) {
					patchLines.push(`- ${searchLines[i]}`)
				}
				for (let i = prefixEnd; i < replaceSuffixStart; i++) {
					patchLines.push(`+ ${replaceLines[i]}`)
				}

				// Add common suffix lines (without +/- markers)
				for (let i = suffixStart; i < searchLines.length; i++) {
					patchLines.push(searchLines[i])
				}

				// Extract up to 3 lines after as trailing context (without @@ markers)
				const contextEnd = Math.min(finalLines.length, matchIndex + replaceLines.length + 3)
				for (let i = matchIndex + replaceLines.length; i < contextEnd; i++) {
					patchLines.push(finalLines[i])
				}

				continue
			}
		}

		// Fallback: if no finalContent or couldn't find match, use the prefix/suffix from SEARCH/REPLACE
		patchLines.push("@@")

		// Add common prefix lines (without +/- markers)
		for (let i = 0; i < prefixEnd; i++) {
			patchLines.push(searchLines[i])
		}

		// Add the actual changes (lines that differ)
		for (let i = prefixEnd; i < suffixStart; i++) {
			patchLines.push(`- ${searchLines[i]}`)
		}
		for (let i = prefixEnd; i < replaceSuffixStart; i++) {
			patchLines.push(`+ ${replaceLines[i]}`)
		}

		// Add common suffix lines (without +/- markers)
		for (let i = suffixStart; i < searchLines.length; i++) {
			patchLines.push(searchLines[i])
		}
	}

	return patchLines.join("\n")
}

/**
 * Reconstruct tool_result content to match apply_patch result format
 */
function reconstructWriteToFileResult(block: any, originalToolName: string, originalInput: any): string | any[] {
	// Extract the content from the tool_result
	const content = typeof block.content === "string" ? block.content : ""

	// Try to extract the final_file_content
	const finalContentMatch = content.match(/<final_file_content path="([^"]+)">\s*([\s\S]*?)\s*<\/final_file_content>/)

	const filePath = originalInput.absolutePath || originalInput.path || ""

	if (!finalContentMatch) {
		// If no final_file_content found, create a simple success message
		if (originalToolName === "write_to_file") {
			return `[apply_patch for '${filePath}'] Result:\nThe content was successfully saved to ${filePath}.\n\nThe file has been created/updated with the new content.`
		} else {
			return `[apply_patch for '${filePath}'] Result:\nThe content was successfully updated in ${filePath}.\n\nThe file has been modified.`
		}
	}

	const finalContent = finalContentMatch[2]

	// Reconstruct the result message based on the original tool type
	if (originalToolName === "write_to_file") {
		return `[apply_patch for '${filePath}'] Result:\nThe content was successfully saved to ${filePath}.\n\nThe file has been created/updated with the new content.`
	}

	if (originalToolName === "replace_in_file") {
		return `[apply_patch for '${filePath}'] Result:\nThe content was successfully updated in ${filePath}.\n\nThe file has been modified using Update operation.\n\n<final_file_content path="${filePath}">\n${finalContent}\n</final_file_content>\n\nIMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference.`
	}

	// Default fallback
	return block.content
}
