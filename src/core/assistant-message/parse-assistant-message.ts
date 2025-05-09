import { AssistantMessageContent, TextContent, ToolUse, ToolParamName, toolParamNames, toolUseNames, ToolUseName } from "."

export function parseAssistantMessage(assistantMessage: string): AssistantMessageContent[] {
	const contentBlocks: AssistantMessageContent[] = []

	let currentTextContentStart = 0
	let currentTextContent: TextContent | undefined = undefined

	let currentToolUseStart = 0
	let currentToolUse: ToolUse | undefined = undefined

	let currentParamValueStart = 0
	let currentParamName: ToolParamName | undefined = undefined

	const toolUseOpenTags = new Map<string, ToolUseName>()
	const toolUseCloseTags = new Map<string, ToolUseName>()
	const toolParamOpenTags = new Map<string, ToolParamName>()
	const toolParamCloseTags = new Map<string, ToolParamName>()

	for (const name of toolUseNames) {
		toolUseOpenTags.set(`<${name}>`, name)
		toolUseCloseTags.set(`</${name}>`, name)
	}

	for (const name of toolParamNames) {
		toolParamOpenTags.set(`<${name}>`, name)
		toolParamCloseTags.set(`</${name}>`, name)
	}

	const len = assistantMessage.length

	for (let i = 0; i < len; i++) {
		// If parsing a tool param
		if (currentToolUse && currentParamName) {
			const closeTag = `</${currentParamName}>`
			if (assistantMessage.startsWith(closeTag, i - closeTag.length + 1)) {
				const value = assistantMessage.slice(currentParamValueStart, i - closeTag.length + 1).trim()
				currentToolUse.params[currentParamName] = value
				currentParamName = undefined
				continue
			}
			continue
		}

		// If parsing a tool
		if (currentToolUse) {
			for (const [tag, paramName] of toolParamOpenTags.entries()) {
				if (assistantMessage.startsWith(tag, i - tag.length + 1)) {
					currentParamName = paramName
					currentParamValueStart = i + 1
					break
				}
			}

			const toolCloseTag = `</${currentToolUse.name}>`
			if (assistantMessage.startsWith(toolCloseTag, i - toolCloseTag.length + 1)) {
				const toolContent = assistantMessage.slice(currentToolUseStart, i - toolCloseTag.length + 1)

				// Special handling for embedded content
				if (
					(currentToolUse.name === "write_to_file" || currentToolUse.name === "new_rule") &&
					toolContent.includes(`<content>`)
				) {
					const contentStartTag = `<content>`
					const contentEndTag = `</content>`
					const contentStart = toolContent.indexOf(contentStartTag)
					const contentEnd = toolContent.lastIndexOf(contentEndTag)

					if (contentStart !== -1 && contentEnd !== -1 && contentEnd > contentStart) {
						const contentValue = toolContent.slice(contentStart + contentStartTag.length, contentEnd).trim()
						currentToolUse.params["content"] = contentValue
					}
				}

				currentToolUse.partial = false
				contentBlocks.push(currentToolUse)
				currentToolUse = undefined
				continue
			}

			continue
		}

		// Look for tool opening tags
		for (const [tag, toolName] of toolUseOpenTags.entries()) {
			if (assistantMessage.startsWith(tag, i - tag.length + 1)) {
				// End current text block if any
				if (currentTextContent) {
					currentTextContent.content = assistantMessage.slice(currentTextContentStart, i - tag.length + 1).trim()
					currentTextContent.partial = false
					contentBlocks.push(currentTextContent)
					currentTextContent = undefined
				}

				currentToolUse = {
					type: "tool_use",
					name: toolName,
					params: {},
					partial: true,
				}
				currentToolUseStart = i + 1
				break
			}
		}

		// If not a tool tag, accumulate text
		if (!currentToolUse) {
			if (!currentTextContent) {
				currentTextContentStart = i
				currentTextContent = {
					type: "text",
					content: "",
					partial: true,
				}
			}
		}
	}

	// Finalize partial param if any
	if (currentToolUse && currentParamName) {
		currentToolUse.params[currentParamName] = assistantMessage.slice(currentParamValueStart).trim()
	}

	// Finalize any open tool use
	if (currentToolUse) {
		contentBlocks.push(currentToolUse)
	}

	// Finalize any trailing text
	if (currentTextContent) {
		currentTextContent.content = assistantMessage.slice(currentTextContentStart).trim()
		contentBlocks.push(currentTextContent)
	}

	return contentBlocks
}
