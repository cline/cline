import { AssistantMessageContent, TextContent, ToolUse, ToolParamName, toolParamNames, toolUseNames, ToolUseName } from "." // Assuming types are defined in index.ts or a similar file

/**
 * @description **Version 1**
 * Parses an assistant message string potentially containing mixed text and tool usage blocks
 * marked with XML-like tags into an array of structured content objects.
 *
 * This version iterates through the message character by character, building an accumulator string.
 * It maintains state to track whether it's currently parsing text, a tool use block, or a specific tool parameter.
 * It detects the start and end of tool uses and parameters by checking if the accumulator ends with
 * the corresponding opening or closing tags.
 * Special handling is included for `write_to_file` and `new_rule` tool uses to correctly parse
 * the `content` parameter, which might contain the closing tag itself, by looking for the *last*
 * occurrence of the closing tag.
 * If the input string ends mid-tag or mid-content, the last block (text or tool use) is marked as partial.
 *
 * @param assistantMessage The raw string output from the assistant.
 * @returns An array of `AssistantMessageContent` objects, which can be `TextContent` or `ToolUse`.
 *          Blocks that were not fully closed by the end of the input string will have their `partial` flag set to `true`.
 */
export function parseAssistantMessageV1(assistantMessage: string): AssistantMessageContent[] {
	const contentBlocks: AssistantMessageContent[] = []
	let currentTextContent: TextContent | undefined = undefined
	let currentTextContentStartIndex = 0
	let currentToolUse: ToolUse | undefined = undefined
	let currentToolUseStartIndex = 0
	let currentParamName: ToolParamName | undefined = undefined
	let currentParamValueStartIndex = 0
	let accumulator = ""

	for (let i = 0; i < assistantMessage.length; i++) {
		const char = assistantMessage[i]
		accumulator += char

		// --- State: Parsing a Tool Parameter ---
		// there should not be a param without a tool use
		if (currentToolUse && currentParamName) {
			const currentParamValue = accumulator.slice(currentParamValueStartIndex)
			const paramClosingTag = `</${currentParamName}>`
			if (currentParamValue.endsWith(paramClosingTag)) {
				// End of param value found
				currentToolUse.params[currentParamName] = currentParamValue.slice(0, -paramClosingTag.length).trim()
				currentParamName = undefined // Go back to parsing tool content or looking for next param
				continue // Move to next character
			} else {
				// Partial param value is accumulating
				continue // Move to next character
			}
		}

		// --- State: Parsing a Tool Use (but not a specific parameter) ---
		// no currentParamName
		if (currentToolUse) {
			const currentToolValue = accumulator.slice(currentToolUseStartIndex)
			const toolUseClosingTag = `</${currentToolUse.name}>`

			if (currentToolValue.endsWith(toolUseClosingTag)) {
				// End of a tool use found
				currentToolUse.partial = false
				contentBlocks.push(currentToolUse)
				currentToolUse = undefined // Go back to parsing text or looking for next tool
				// Reset text start index in case text follows immediately
				currentTextContentStartIndex = i + 1
				continue // Move to next character
			} else {
				// Check if starting a new parameter within the current tool use
				const possibleParamOpeningTags = toolParamNames.map((name) => `<${name}>`)
				let foundParamStart = false
				for (const paramOpeningTag of possibleParamOpeningTags) {
					if (accumulator.endsWith(paramOpeningTag)) {
						// Start of a new parameter found
						currentParamName = paramOpeningTag.slice(1, -1) as ToolParamName
						currentParamValueStartIndex = accumulator.length
						foundParamStart = true
						break
					}
				}
				if (foundParamStart) {
					continue // Move to next character
				}

				// Special case for write_to_file/new_rule content param allowing nested tags
				// Check if a </content> tag appears, potentially indicating the end of the content param
				// even if the main tool closing tag hasn't been seen yet.
				const contentParamName: ToolParamName = "content"
				if (
					(currentToolUse.name === "write_to_file" || currentToolUse.name === "new_rule") &&
					accumulator.endsWith(`</${contentParamName}>`)
				) {
					const toolContent = accumulator.slice(currentToolUseStartIndex)
					const contentStartTag = `<${contentParamName}>`
					const contentEndTag = `</${contentParamName}>`
					const contentStartIndex = toolContent.indexOf(contentStartTag) + contentStartTag.length
					// Use lastIndexOf to handle cases where </content> might appear within the content itself
					const contentEndIndex = toolContent.lastIndexOf(contentEndTag)

					// Ensure we found valid start/end tags and end is after start
					if (
						contentStartIndex !== -1 &&
						contentEndIndex !== -1 &&
						contentEndIndex > contentStartIndex - contentStartTag.length // Ensure end tag is after start tag begins
					) {
						// Check if this content param was already being parsed. If so, update it.
						// If not, and we just found the closing tag, assign it.
						// This handles cases where the </content> detection might fire before
						// the <content> tag detection logic, or if the content is very short.
						if (currentParamName === contentParamName) {
							// Already parsing content, now we found the end tag
							currentToolUse.params[contentParamName] = toolContent.slice(contentStartIndex, contentEndIndex).trim()
							currentParamName = undefined // Finished with this param
						} else if (currentParamName === undefined) {
							// Not parsing a param, but found </content>. Assume it closes the content block.
							currentToolUse.params[contentParamName] = toolContent.slice(contentStartIndex, contentEndIndex).trim()
							// We stay in the "parsing tool use" state, looking for more params or the tool end tag.
						}
					}
				}

				// If none of the above, partial tool value is accumulating
				continue // Move to next character
			}
		}

		// --- State: Parsing Text (or looking for start of a tool use) ---
		// no currentToolUse
		let didStartToolUse = false
		const possibleToolUseOpeningTags = toolUseNames.map((name) => `<${name}>`)
		for (const toolUseOpeningTag of possibleToolUseOpeningTags) {
			if (accumulator.endsWith(toolUseOpeningTag)) {
				// Start of a new tool use found
				const toolName = toolUseOpeningTag.slice(1, -1) as ToolUseName
				currentToolUse = {
					type: "tool_use",
					name: toolName,
					params: {},
					partial: true,
				}
				currentToolUseStartIndex = accumulator.length

				// This also indicates the end of the current text content block (if any)
				if (currentTextContent) {
					currentTextContent.partial = false
					// Extract text content, removing the part that formed the tool opening tag
					const textEndIndex = accumulator.length - toolUseOpeningTag.length
					currentTextContent.content = accumulator.slice(currentTextContentStartIndex, textEndIndex).trim()
					// Only add if there's actual content
					if (currentTextContent.content.length > 0) {
						contentBlocks.push(currentTextContent)
					}
					currentTextContent = undefined
				} else {
					// Check if there was text before this tool use started
					const textEndIndex = accumulator.length - toolUseOpeningTag.length
					const potentialText = accumulator.slice(currentTextContentStartIndex, textEndIndex).trim()
					if (potentialText.length > 0) {
						contentBlocks.push({
							type: "text",
							content: potentialText,
							partial: false, // Ended because tool use started
						})
					}
				}

				didStartToolUse = true
				break // Found tool start, stop checking for others
			}
		}

		if (!didStartToolUse) {
			// No tool use started, so it must be text content accumulating
			// (or continuing after a closed tool use)
			if (currentTextContent === undefined) {
				// Start of a new text block
				currentTextContentStartIndex = i - (accumulator.length - currentTextContentStartIndex - 1) // Adjust start index based on how much we've accumulated since the last block ended or the beginning
				// If accumulator starts from 0, start index is i
				if (contentBlocks.length === 0 && currentToolUse === undefined) {
					currentTextContentStartIndex = accumulator.length - 1 // i
				} else {
					// Re-calculate based on the actual start of the current text segment
					// Find the end of the last block
					let lastBlockEndIndex = 0
					if (contentBlocks.length > 0) {
						const lastBlock = contentBlocks[contentBlocks.length - 1]
						// Approximation: find where the accumulator matches the end of the message string representation of the last block. This is complex.
						// Simpler: Assume text starts right after the last block ended implicitly at index i.
						lastBlockEndIndex = i // Where the loop *was* when the last block finished processing
						// Need a more robust way to track the end index of the *raw string* corresponding to the last block.
						// Let's stick to the accumulator slice approach for simplicity in this version.
						// The start index should be where the current *unmatched* text began.
						let lastProcessedIndex = -1
						if (contentBlocks.length > 0) {
							// This requires knowing the raw string length of the previous block, which V1 doesn't explicitly track easily.
							// We'll approximate based on the current accumulator and start index logic.
							// The issue arises if a tool tag was just closed. accumulator contains everything up to i.
							// lastBlockEndIndex should point to the character *after* the closing tag of the last block.
						}
						// Reset start index to the beginning of the *current* potential text block
						currentTextContentStartIndex = accumulator.length - 1 // Start accumulating from the current character `i`
					}

					// If we just closed a tool, text starts *after* its closing tag
					// The logic needs refinement here for accurate start index after a tool closure.
					// Let's assume for now the start index logic inside the loop handles it via slicing.
				}

				currentTextContent = {
					type: "text",
					content: "", // Content will be filled by slicing accumulator
					partial: true,
				}
			}
			// Update text content based on the accumulator from its start index
			currentTextContent.content = accumulator.slice(currentTextContentStartIndex).trimStart() // Trim start to avoid leading space if text follows tool
		}
	} // End of loop

	// --- Finalization after loop ---

	// If a tool use was open at the end
	if (currentToolUse) {
		// If a parameter was open within that tool use
		if (currentParamName) {
			// The remaining accumulator content belongs to this partial parameter
			currentToolUse.params[currentParamName] = accumulator.slice(currentParamValueStartIndex).trim()
		}
		// Add the potentially partial tool use block
		contentBlocks.push(currentToolUse)
	}
	// If text content was being accumulated at the end
	// Note: Only one of currentToolUse or currentTextContent can be defined here,
	// as starting a tool use finalizes the preceding text block.
	else if (currentTextContent) {
		// Update content one last time
		currentTextContent.content = accumulator.slice(currentTextContentStartIndex).trim()
		// Add the potentially partial text block only if it contains content
		if (currentTextContent.content.length > 0) {
			contentBlocks.push(currentTextContent)
		}
	}

	return contentBlocks
}

/**
 * @description **Version 2**
 * Parses an assistant message string potentially containing mixed text and tool usage blocks
 * marked with XML-like tags into an array of structured content objects.
 *
 * This version aims for efficiency by avoiding the character-by-character accumulator of V1.
 * It iterates through the string using an index `i`. At each position, it checks if the substring
 * *ending* at `i` matches any known opening or closing tags for tools or parameters using `startsWith`
 * with an offset.
 * It uses pre-computed Maps (`toolUseOpenTags`, `toolParamOpenTags`) for quick tag lookups.
 * State is managed using indices (`currentTextContentStart`, `currentToolUseStart`, `currentParamValueStart`)
 * pointing to the start of the current block within the original `assistantMessage` string.
 * Slicing is used to extract content only when a block (text, parameter, or tool use) is completed.
 * Special handling for `write_to_file` and `new_rule` content parameters is included, using `indexOf`
 * and `lastIndexOf` on the relevant slice to handle potentially nested closing tags.
 * If the input string ends mid-block, the last open block is added and marked as partial.
 *
 * @param assistantMessage The raw string output from the assistant.
 * @returns An array of `AssistantMessageContent` objects, which can be `TextContent` or `ToolUse`.
 *          Blocks that were not fully closed by the end of the input string will have their `partial` flag set to `true`.
 */
export function parseAssistantMessageV2(assistantMessage: string): AssistantMessageContent[] {
	const contentBlocks: AssistantMessageContent[] = []
	let currentTextContentStart = 0 // Index where the current text block started
	let currentTextContent: TextContent | undefined = undefined
	let currentToolUseStart = 0 // Index *after* the opening tag of the current tool use
	let currentToolUse: ToolUse | undefined = undefined
	let currentParamValueStart = 0 // Index *after* the opening tag of the current param
	let currentParamName: ToolParamName | undefined = undefined

	// Precompute tags for faster lookups
	const toolUseOpenTags = new Map<string, ToolUseName>()
	const toolParamOpenTags = new Map<string, ToolParamName>()
	for (const name of toolUseNames) {
		toolUseOpenTags.set(`<${name}>`, name)
	}
	for (const name of toolParamNames) {
		toolParamOpenTags.set(`<${name}>`, name)
	}

	const len = assistantMessage.length
	for (let i = 0; i < len; i++) {
		const currentCharIndex = i

		// --- State: Parsing a Tool Parameter ---
		if (currentToolUse && currentParamName) {
			const closeTag = `</${currentParamName}>`
			// Check if the string *ending* at index `i` matches the closing tag
			if (
				currentCharIndex >= closeTag.length - 1 &&
				assistantMessage.startsWith(
					closeTag,
					currentCharIndex - closeTag.length + 1, // Start checking from potential start of tag
				)
			) {
				// Found the closing tag for the parameter
				const value = assistantMessage
					.slice(
						currentParamValueStart, // Start after the opening tag
						currentCharIndex - closeTag.length + 1, // End before the closing tag
					)
					.trim()
				currentToolUse.params[currentParamName] = value
				currentParamName = undefined // Go back to parsing tool content
				// We don't continue loop here, need to check for tool close or other params at index i
			} else {
				continue // Still inside param value, move to next char
			}
		}

		// --- State: Parsing a Tool Use (but not a specific parameter) ---
		if (currentToolUse && !currentParamName) {
			// Ensure we are not inside a parameter already
			// Check if starting a new parameter
			let startedNewParam = false
			for (const [tag, paramName] of toolParamOpenTags.entries()) {
				if (currentCharIndex >= tag.length - 1 && assistantMessage.startsWith(tag, currentCharIndex - tag.length + 1)) {
					currentParamName = paramName
					currentParamValueStart = currentCharIndex + 1 // Value starts after the tag
					startedNewParam = true
					break
				}
			}
			if (startedNewParam) {
				continue // Handled start of param, move to next char
			}

			// Check if closing the current tool use
			const toolCloseTag = `</${currentToolUse.name}>`
			if (
				currentCharIndex >= toolCloseTag.length - 1 &&
				assistantMessage.startsWith(toolCloseTag, currentCharIndex - toolCloseTag.length + 1)
			) {
				// End of the tool use found
				// Special handling for content params *before* finalizing the tool
				const toolContentSlice = assistantMessage.slice(
					currentToolUseStart, // From after the tool opening tag
					currentCharIndex - toolCloseTag.length + 1, // To before the tool closing tag
				)

				// Check if content parameter needs special handling (write_to_file/new_rule)
				// This check is important if the closing </content> tag was missed by the parameter parsing logic
				// (e.g., if content is empty or parsing logic prioritizes tool close)
				const contentParamName: ToolParamName = "content"
				if (
					currentToolUse.name === "write_to_file" /* || currentToolUse.name === "new_rule" */ &&
					toolContentSlice.includes(`<${contentParamName}>`)
				) {
					const contentStartTag = `<${contentParamName}>`
					const contentEndTag = `</${contentParamName}>`
					const contentStart = toolContentSlice.indexOf(contentStartTag)
					// Use lastIndexOf for robustness against nested tags
					const contentEnd = toolContentSlice.lastIndexOf(contentEndTag)

					if (contentStart !== -1 && contentEnd !== -1 && contentEnd > contentStart) {
						const contentValue = toolContentSlice.slice(contentStart + contentStartTag.length, contentEnd).trim()
						currentToolUse.params[contentParamName] = contentValue
					}
				}

				currentToolUse.partial = false // Mark as complete
				contentBlocks.push(currentToolUse)
				currentToolUse = undefined // Reset state
				currentTextContentStart = currentCharIndex + 1 // Potential text starts after this tag
				continue // Move to next char
			}
			// If not starting a param and not closing the tool, continue accumulating tool content implicitly
			continue
		}

		// --- State: Parsing Text / Looking for Tool Start ---
		if (!currentToolUse) {
			// Check if starting a new tool use
			let startedNewTool = false
			for (const [tag, toolName] of toolUseOpenTags.entries()) {
				if (currentCharIndex >= tag.length - 1 && assistantMessage.startsWith(tag, currentCharIndex - tag.length + 1)) {
					// End current text block if one was active
					if (currentTextContent) {
						currentTextContent.content = assistantMessage
							.slice(
								currentTextContentStart, // From where text started
								currentCharIndex - tag.length + 1, // To before the tool tag starts
							)
							.trim()
						currentTextContent.partial = false // Ended because tool started
						if (currentTextContent.content.length > 0) {
							contentBlocks.push(currentTextContent)
						}
						currentTextContent = undefined
					} else {
						// Check for any text between the last block and this tag
						const potentialText = assistantMessage
							.slice(
								currentTextContentStart, // From where text *might* have started
								currentCharIndex - tag.length + 1, // To before the tool tag starts
							)
							.trim()
						if (potentialText.length > 0) {
							contentBlocks.push({
								type: "text",
								content: potentialText,
								partial: false,
							})
						}
					}

					// Start the new tool use
					currentToolUse = {
						type: "tool_use",
						name: toolName,
						params: {},
						partial: true, // Assume partial until closing tag is found
					}
					currentToolUseStart = currentCharIndex + 1 // Tool content starts after the opening tag
					startedNewTool = true
					break
				}
			}

			if (startedNewTool) {
				continue // Handled start of tool, move to next char
			}

			// If not starting a tool, it must be text content
			if (!currentTextContent) {
				// Start a new text block if we aren't already in one
				currentTextContentStart = currentCharIndex // Text starts at the current character
				// Check if the current char is the start of potential text *immediately* after a tag
				// This needs the previous state - simpler to let slicing handle it later.
				// Resetting start index accurately is key.
				// It should be the index *after* the last processed tag.
				// The logic managing currentTextContentStart after closing tags handles this.

				currentTextContent = {
					type: "text",
					content: "", // Will be determined by slicing at the end or when a tool starts
					partial: true,
				}
			}
			// Continue accumulating text implicitly; content is extracted later.
		}
	} // End of loop

	// --- Finalization after loop ---

	// Finalize any open parameter within an open tool use
	if (currentToolUse && currentParamName) {
		currentToolUse.params[currentParamName] = assistantMessage
			.slice(currentParamValueStart) // From param start to end of string
			.trim()
		// Tool use remains partial
	}

	// Finalize any open tool use (which might contain the finalized partial param)
	if (currentToolUse) {
		// Tool use is partial because the loop finished before its closing tag
		contentBlocks.push(currentToolUse)
	}
	// Finalize any trailing text content
	// Only possible if a tool use wasn't open at the very end
	else if (currentTextContent) {
		currentTextContent.content = assistantMessage
			.slice(currentTextContentStart) // From text start to end of string
			.trim()
		// Text is partial because the loop finished
		if (currentTextContent.content.length > 0) {
			contentBlocks.push(currentTextContent)
		}
	}

	return contentBlocks
}

export function parseAssistantMessageV3(assistantMessage: string): AssistantMessageContent[] {
	const contentBlocks: AssistantMessageContent[] = []
	let currentTextContentStart = 0 // Index where the current text block started
	let currentTextContent: TextContent | undefined = undefined
	let currentToolUseStart = 0 // Index *after* the opening tag of the current tool use
	let currentToolUse: ToolUse | undefined = undefined
	let currentParamValueStart = 0 // Index *after* the opening tag of the current param
	let currentParamName: ToolParamName | undefined = undefined

	// Precompute tags for faster lookups
	const toolUseOpenTags = new Map<string, ToolUseName>()
	const toolParamOpenTags = new Map<string, ToolParamName>()
	for (const name of toolUseNames) {
		toolUseOpenTags.set(`<${name}>`, name)
	}
	for (const name of toolParamNames) {
		toolParamOpenTags.set(`<${name}>`, name)
	}

	// Function calls format detection
	const isFunctionCallsOpen = "<function_calls>"
	const isFunctionCallsClose = "</function_calls>"
	const isInvokeStart = '<invoke name="'
	const isInvokeEnd = '">'
	const isInvokeClose = "</invoke>"
	const isParameterStart = '<parameter name="'
	const isParameterNameEnd = '">'
	const isParameterClose = "</parameter>"

	// Variables for function calls parsing
	let inFunctionCalls = false
	let currentInvokeName = ""
	let currentParameterName = ""

	const len = assistantMessage.length
	for (let i = 0; i < len; i++) {
		const currentCharIndex = i

		// --- State: Parsing Function Calls ---
		// Check for opening function_calls tag
		if (
			!inFunctionCalls &&
			currentCharIndex >= isFunctionCallsOpen.length - 1 &&
			assistantMessage.startsWith(isFunctionCallsOpen, currentCharIndex - isFunctionCallsOpen.length + 1)
		) {
			// End current text block if one was active
			if (currentTextContent) {
				currentTextContent.content = assistantMessage
					.slice(currentTextContentStart, currentCharIndex - isFunctionCallsOpen.length + 1)
					.trim()
				currentTextContent.partial = false
				if (currentTextContent.content.length > 0) {
					contentBlocks.push(currentTextContent)
				}
				currentTextContent = undefined
			}

			inFunctionCalls = true
			continue
		}

		// Check for invoke start within function_calls
		if (
			inFunctionCalls &&
			currentInvokeName === "" &&
			currentCharIndex >= isInvokeStart.length - 1 &&
			assistantMessage.startsWith(isInvokeStart, currentCharIndex - isInvokeStart.length + 1)
		) {
			// Find the end of the invoke name
			const nameEndPos = assistantMessage.indexOf(isInvokeEnd, currentCharIndex + 1)
			if (nameEndPos !== -1) {
				// Extract the invoke name
				currentInvokeName = assistantMessage.slice(currentCharIndex + 1, nameEndPos)
				i = nameEndPos + isInvokeEnd.length - 1 // Skip to after the '">

				// If this is an LS invoke, create a list_files tool
				if (currentInvokeName === "LS") {
					currentToolUse = {
						type: "tool_use",
						name: "list_files",
						params: {},
						partial: true,
					}
				}
				continue
			}
		}

		// Check for parameter start within invoke
		if (
			inFunctionCalls &&
			currentInvokeName !== "" &&
			currentParameterName === "" &&
			currentCharIndex >= isParameterStart.length - 1 &&
			assistantMessage.startsWith(isParameterStart, currentCharIndex - isParameterStart.length + 1)
		) {
			// Find the end of the parameter name
			const nameEndPos = assistantMessage.indexOf(isParameterNameEnd, currentCharIndex + 1)
			if (nameEndPos !== -1) {
				// Extract the parameter name
				currentParameterName = assistantMessage.slice(currentCharIndex + 1, nameEndPos)
				currentParamValueStart = nameEndPos + isParameterNameEnd.length
				i = nameEndPos + isParameterNameEnd.length - 1 // Skip to after the '">'
				continue
			}
		}

		// Check for parameter end
		if (
			inFunctionCalls &&
			currentInvokeName !== "" &&
			currentParameterName !== "" &&
			currentCharIndex >= isParameterClose.length - 1 &&
			assistantMessage.startsWith(isParameterClose, currentCharIndex - isParameterClose.length + 1)
		) {
			// Extract parameter value
			const value = assistantMessage.slice(currentParamValueStart, currentCharIndex - isParameterClose.length + 1).trim()

			// Map parameter to tool params
			if (currentToolUse && currentInvokeName === "LS" && currentParameterName === "path") {
				currentToolUse.params["path"] = value
				// Default recursive to false - only show top level
				currentToolUse.params["recursive"] = "false"
			}

			currentParameterName = ""
			continue
		}

		// Check for invoke end
		if (
			inFunctionCalls &&
			currentInvokeName !== "" &&
			currentCharIndex >= isInvokeClose.length - 1 &&
			assistantMessage.startsWith(isInvokeClose, currentCharIndex - isInvokeClose.length + 1)
		) {
			// If we have a tool use from this invoke, finalize it
			if (currentToolUse && currentInvokeName === "LS") {
				currentToolUse.partial = false
				contentBlocks.push(currentToolUse)
				currentToolUse = undefined
			}

			currentInvokeName = ""
			continue
		}

		// Check for function_calls end
		if (
			inFunctionCalls &&
			currentCharIndex >= isFunctionCallsClose.length - 1 &&
			assistantMessage.startsWith(isFunctionCallsClose, currentCharIndex - isFunctionCallsClose.length + 1)
		) {
			inFunctionCalls = false
			currentTextContentStart = currentCharIndex + 1
			continue
		}

		// Skip normal parsing when inside function_calls
		if (inFunctionCalls) {
			continue
		}

		// --- State: Parsing a Tool Parameter ---
		if (currentToolUse && currentParamName) {
			const closeTag = `</${currentParamName}>`
			// Check if the string *ending* at index `i` matches the closing tag
			if (
				currentCharIndex >= closeTag.length - 1 &&
				assistantMessage.startsWith(
					closeTag,
					currentCharIndex - closeTag.length + 1, // Start checking from potential start of tag
				)
			) {
				// Found the closing tag for the parameter
				const value = assistantMessage
					.slice(
						currentParamValueStart, // Start after the opening tag
						currentCharIndex - closeTag.length + 1, // End before the closing tag
					)
					.trim()
				currentToolUse.params[currentParamName] = value
				currentParamName = undefined // Go back to parsing tool content
				// We don't continue loop here, need to check for tool close or other params at index i
			} else {
				continue // Still inside param value, move to next char
			}
		}

		// --- State: Parsing a Tool Use (but not a specific parameter) ---
		if (currentToolUse && !currentParamName) {
			// Ensure we are not inside a parameter already
			// Check if starting a new parameter
			let startedNewParam = false
			for (const [tag, paramName] of toolParamOpenTags.entries()) {
				if (currentCharIndex >= tag.length - 1 && assistantMessage.startsWith(tag, currentCharIndex - tag.length + 1)) {
					currentParamName = paramName
					currentParamValueStart = currentCharIndex + 1 // Value starts after the tag
					startedNewParam = true
					break
				}
			}
			if (startedNewParam) {
				continue // Handled start of param, move to next char
			}

			// Check if closing the current tool use
			const toolCloseTag = `</${currentToolUse.name}>`
			if (
				currentCharIndex >= toolCloseTag.length - 1 &&
				assistantMessage.startsWith(toolCloseTag, currentCharIndex - toolCloseTag.length + 1)
			) {
				// End of the tool use found
				// Special handling for content params *before* finalizing the tool
				const toolContentSlice = assistantMessage.slice(
					currentToolUseStart, // From after the tool opening tag
					currentCharIndex - toolCloseTag.length + 1, // To before the tool closing tag
				)

				// Check if content parameter needs special handling (write_to_file/new_rule)
				// This check is important if the closing </content> tag was missed by the parameter parsing logic
				// (e.g., if content is empty or parsing logic prioritizes tool close)
				const contentParamName: ToolParamName = "content"
				if (
					currentToolUse.name === "write_to_file" /* || currentToolUse.name === "new_rule" */ &&
					toolContentSlice.includes(`<${contentParamName}>`)
				) {
					const contentStartTag = `<${contentParamName}>`
					const contentEndTag = `</${contentParamName}>`
					const contentStart = toolContentSlice.indexOf(contentStartTag)
					// Use lastIndexOf for robustness against nested tags
					const contentEnd = toolContentSlice.lastIndexOf(contentEndTag)

					if (contentStart !== -1 && contentEnd !== -1 && contentEnd > contentStart) {
						const contentValue = toolContentSlice.slice(contentStart + contentStartTag.length, contentEnd).trim()
						currentToolUse.params[contentParamName] = contentValue
					}
				}

				currentToolUse.partial = false // Mark as complete
				contentBlocks.push(currentToolUse)
				currentToolUse = undefined // Reset state
				currentTextContentStart = currentCharIndex + 1 // Potential text starts after this tag
				continue // Move to next char
			}
			// If not starting a param and not closing the tool, continue accumulating tool content implicitly
			continue
		}

		// --- State: Parsing Text / Looking for Tool Start ---
		if (!currentToolUse) {
			// Check if starting a new tool use
			let startedNewTool = false
			for (const [tag, toolName] of toolUseOpenTags.entries()) {
				if (currentCharIndex >= tag.length - 1 && assistantMessage.startsWith(tag, currentCharIndex - tag.length + 1)) {
					// End current text block if one was active
					if (currentTextContent) {
						currentTextContent.content = assistantMessage
							.slice(
								currentTextContentStart, // From where text started
								currentCharIndex - tag.length + 1, // To before the tool tag starts
							)
							.trim()
						currentTextContent.partial = false // Ended because tool started
						if (currentTextContent.content.length > 0) {
							contentBlocks.push(currentTextContent)
						}
						currentTextContent = undefined
					} else {
						// Check for any text between the last block and this tag
						const potentialText = assistantMessage
							.slice(
								currentTextContentStart, // From where text *might* have started
								currentCharIndex - tag.length + 1, // To before the tool tag starts
							)
							.trim()
						if (potentialText.length > 0) {
							contentBlocks.push({
								type: "text",
								content: potentialText,
								partial: false,
							})
						}
					}

					// Start the new tool use
					currentToolUse = {
						type: "tool_use",
						name: toolName,
						params: {},
						partial: true, // Assume partial until closing tag is found
					}
					currentToolUseStart = currentCharIndex + 1 // Tool content starts after the opening tag
					startedNewTool = true
					break
				}
			}

			if (startedNewTool) {
				continue // Handled start of tool, move to next char
			}

			// If not starting a tool, it must be text content
			if (!currentTextContent) {
				// Start a new text block if we aren't already in one
				currentTextContentStart = currentCharIndex // Text starts at the current character
				// Check if the current char is the start of potential text *immediately* after a tag
				// This needs the previous state - simpler to let slicing handle it later.
				// Resetting start index accurately is key.
				// It should be the index *after* the last processed tag.
				// The logic managing currentTextContentStart after closing tags handles this.

				currentTextContent = {
					type: "text",
					content: "", // Will be determined by slicing at the end or when a tool starts
					partial: true,
				}
			}
			// Continue accumulating text implicitly; content is extracted later.
		}
	} // End of loop

	// --- Finalization after loop ---

	// Finalize any open parameter within an open tool use
	if (currentToolUse && currentParamName) {
		currentToolUse.params[currentParamName] = assistantMessage
			.slice(currentParamValueStart) // From param start to end of string
			.trim()
		// Tool use remains partial
	}

	// Finalize any open tool use (which might contain the finalized partial param)
	if (currentToolUse) {
		// Tool use is partial because the loop finished before its closing tag
		contentBlocks.push(currentToolUse)
	}
	// Finalize any trailing text content
	// Only possible if a tool use wasn't open at the very end
	else if (currentTextContent) {
		currentTextContent.content = assistantMessage
			.slice(currentTextContentStart) // From text start to end of string
			.trim()
		// Text is partial because the loop finished
		if (currentTextContent.content.length > 0) {
			contentBlocks.push(currentTextContent)
		}
	}

	return contentBlocks
}
