import { TextContent, ToolUse, ToolParamName, toolParamNames } from "../../shared/tools"
import { toolNames, ToolName } from "../../schemas"

export type AssistantMessageContent = TextContent | ToolUse

export function parseAssistantMessage(assistantMessage: string): AssistantMessageContent[] {
	let contentBlocks: AssistantMessageContent[] = []
	let currentTextContent: TextContent | undefined = undefined
	let currentTextContentStartIndex = 0
	let currentToolUse: ToolUse | undefined = undefined
	let currentToolUseStartIndex = 0
	let currentParamName: ToolParamName | undefined = undefined
	let currentParamValueStartIndex = 0
	let accumulator = ""

	// Track whether we are inside markdown code blocks or inline code to avoid treating textual mentions
	// of tool tags (e.g. <read_file>) as actual tool invocations.
	let insideCodeBlock = false // ``` fenced code block
	let insideInlineCode = false // `inline code`

	// Helper to decide if we should parse for tool-related tags at the current position
	const shouldParseToolTags = () => !insideCodeBlock && !insideInlineCode

	for (let i = 0; i < assistantMessage.length; i++) {
		const char = assistantMessage[i]

		// Detect fenced code block (```).
		if (!insideInlineCode && assistantMessage.slice(i, i + 3) === "```") {
			insideCodeBlock = !insideCodeBlock
			// Append the full trio of backticks to accumulator.
			accumulator += "```"
			i += 2 // Skip the two extra backticks we just added.

			// When toggling code block state, continue to next iteration as
			// these chars are text.
			continue
		}

		// Detect inline code (`) when not inside a fenced code block and not part of triple backticks
		if (!insideCodeBlock && char === "`") {
			insideInlineCode = !insideInlineCode
		}

		accumulator += char

		// If we are in any kind of code context, treat everything as plain text.
		if (!shouldParseToolTags()) {
			// Handle accumulating text content block.
			if (currentTextContent === undefined) {
				currentTextContentStartIndex = i
			}

			currentTextContent = {
				type: "text",
				content: accumulator.slice(currentTextContentStartIndex).trim(),
				partial: true,
			}

			continue
		}

		// There should not be a param without a tool use.
		if (currentToolUse && currentParamName) {
			const currentParamValue = accumulator.slice(currentParamValueStartIndex)
			const paramClosingTag = `</${currentParamName}>`
			if (currentParamValue.endsWith(paramClosingTag)) {
				// End of param value.
				currentToolUse.params[currentParamName] = currentParamValue.slice(0, -paramClosingTag.length).trim()
				currentParamName = undefined
				continue
			} else {
				// Partial param value is accumulating.
				continue
			}
		}

		// No currentParamName.

		if (currentToolUse) {
			const currentToolValue = accumulator.slice(currentToolUseStartIndex)
			const toolUseClosingTag = `</${currentToolUse.name}>`
			if (currentToolValue.endsWith(toolUseClosingTag)) {
				// End of a tool use.
				currentToolUse.partial = false
				contentBlocks.push(currentToolUse)
				currentToolUse = undefined
				continue
			} else {
				const possibleParamOpeningTags = toolParamNames.map((name) => `<${name}>`)

				for (const paramOpeningTag of possibleParamOpeningTags) {
					if (accumulator.endsWith(paramOpeningTag)) {
						// Start of a new parameter.
						currentParamName = paramOpeningTag.slice(1, -1) as ToolParamName
						currentParamValueStartIndex = accumulator.length
						break
					}
				}

				// There's no current param, and not starting a new param.

				// Special case for write_to_file where file contents could
				// contain the closing tag, in which case the param would have
				// closed and we end up with the rest of the file contents here.
				// To work around this, we get the string between the starting
				// ontent tag and the LAST content tag.
				const contentParamName: ToolParamName = "content"

				if (currentToolUse.name === "write_to_file" && accumulator.endsWith(`</${contentParamName}>`)) {
					const toolContent = accumulator.slice(currentToolUseStartIndex)
					const contentStartTag = `<${contentParamName}>`
					const contentEndTag = `</${contentParamName}>`
					const contentStartIndex = toolContent.indexOf(contentStartTag) + contentStartTag.length
					const contentEndIndex = toolContent.lastIndexOf(contentEndTag)

					if (contentStartIndex !== -1 && contentEndIndex !== -1 && contentEndIndex > contentStartIndex) {
						currentToolUse.params[contentParamName] = toolContent
							.slice(contentStartIndex, contentEndIndex)
							.trim()
					}
				}

				// Partial tool value is accumulating.
				continue
			}
		}

		// No currentToolUse.

		let didStartToolUse = false
		const possibleToolUseOpeningTags = toolNames.map((name) => `<${name}>`)

		for (const toolUseOpeningTag of possibleToolUseOpeningTags) {
			if (accumulator.endsWith(toolUseOpeningTag)) {
				// Check that this is likely an actual tool invocation and not
				// an inline textual reference.
				// We consider it an invocation only if the next non-whitespace
				// character is a newline (\n or \r) or an opening angle bracket
				// '<' (which would start the first parameter tag).

				let j = i + 1 // Position after the closing '>' of the opening tag.

				while (j < assistantMessage.length && assistantMessage[j] === " ") {
					j++
				}

				const nextChar = assistantMessage[j] ?? ""

				if (nextChar && nextChar !== "<" && nextChar !== "\n" && nextChar !== "\r") {
					// Treat as plain text, not a tool invocation.
					continue
				}

				// Start of a new tool use.
				currentToolUse = {
					type: "tool_use",
					name: toolUseOpeningTag.slice(1, -1) as ToolName,
					params: {},
					partial: true,
				}

				currentToolUseStartIndex = accumulator.length

				// This also indicates the end of the current text content.
				if (currentTextContent) {
					currentTextContent.partial = false

					// Remove the partially accumulated tool use tag from the
					// end of text (<tool).
					currentTextContent.content = currentTextContent.content
						.slice(0, -toolUseOpeningTag.slice(0, -1).length)
						.trim()

					contentBlocks.push(currentTextContent)
					currentTextContent = undefined
				}

				didStartToolUse = true
				break
			}
		}

		if (!didStartToolUse) {
			// No tool use, so it must be text either at the beginning or
			// between tools.
			if (currentTextContent === undefined) {
				currentTextContentStartIndex = i
			}

			currentTextContent = {
				type: "text",
				content: accumulator.slice(currentTextContentStartIndex).trim(),
				partial: true,
			}
		}
	}

	if (currentToolUse) {
		// Stream did not complete tool call, add it as partial.
		if (currentParamName) {
			// Tool call has a parameter that was not completed.
			currentToolUse.params[currentParamName] = accumulator.slice(currentParamValueStartIndex).trim()
		}

		contentBlocks.push(currentToolUse)
	}

	// NOTE: It doesn't matter if check for currentToolUse or
	// currentTextContent, only one of them will be defined since only one can
	// be partial at a time.
	if (currentTextContent) {
		// Stream did not complete text content, add it as partial.
		contentBlocks.push(currentTextContent)
	}

	// Remove any empty text blocks that may have been created by whitespace or newlines before/after tool calls
	return contentBlocks.filter((block) => !(block.type === "text" && block.content.trim().length === 0))
}
