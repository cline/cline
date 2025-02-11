import { Anthropic } from "@anthropic-ai/sdk"

interface CursorMessage {
	type: "MESSAGE_TYPE_HUMAN" | "MESSAGE_TYPE_AI"
	text: string
	attached_code_chunks: Array<{
		relativeWorkspacePath: string
		startLineNumber: number
		lines: string[]
	}>
}

/**
 * Converts Anthropic messages to Cursor format
 * @param systemPrompt The system prompt to be included as the first message
 * @param messages Array of Anthropic messages to convert
 * @returns Array of Cursor messages
 */
export function convertToCursorMessages(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): CursorMessage[] {
	const cursorMessages: CursorMessage[] = []

	// Add system prompt as first user message
	if (systemPrompt) {
		cursorMessages.push({
			type: "MESSAGE_TYPE_HUMAN",
			text: systemPrompt,
			attached_code_chunks: [],
		})
	}

	// Process each message
	for (const message of messages) {
		let text: string
		if (typeof message.content === "string") {
			text = message.content
		} else {
			// For array content, process each block appropriately
			text = message.content
				.map((block) => {
					if (block.type === "text") {
						return (block as Anthropic.Messages.TextBlockParam).text
					} else if (block.type === "tool_use") {
						// Format tool calls in XML-style structure
						const toolUse = block as Anthropic.Messages.ToolUseBlock
						const params = Object.entries(toolUse.input || {})
							.map(([key, value]) => `<${key}>${JSON.stringify(value)}</${key}>`)
							.join("\n")
						return `<${toolUse.name}>\n${params}\n</${toolUse.name}>`
					}
					return ""
				})
				.filter(Boolean)
				.join("\n")
		}

		cursorMessages.push({
			type: message.role === "user" ? "MESSAGE_TYPE_HUMAN" : "MESSAGE_TYPE_AI",
			text,
			attached_code_chunks: [],
		})
	}

	return cursorMessages
}

/**
 * Converts a Cursor message back to Anthropic format
 * @param message The Cursor message to convert
 * @returns Anthropic message format
 */
export function convertToAnthropicMessage(message: CursorMessage): Anthropic.Messages.MessageParam {
	return {
		role: message.type === "MESSAGE_TYPE_HUMAN" ? "user" : "assistant",
		content: [
			{
				type: "text",
				text: message.text,
			},
		],
	}
}
