import { Anthropic } from "@anthropic-ai/sdk"
import { countTokens } from "@anthropic-ai/tokenizer"

export function slidingWindowContextManagement(
	contextWindow: number,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	tools: Anthropic.Messages.Tool[]
): Anthropic.Messages.MessageParam[] {
	const adjustedContextWindow = contextWindow - 10_000 // Buffer to account for tokenizer differences
	const systemPromptTokens = countTokens(systemPrompt)
	const toolsTokens = countTokens(JSON.stringify(tools))
	let availableTokens = adjustedContextWindow - systemPromptTokens - toolsTokens
	let totalMessageTokens = messages.reduce((sum, message) => sum + countMessageTokens(message), 0)

	if (totalMessageTokens <= availableTokens) {
		return messages
	}

	// If over limit, remove messages starting from the third message onwards (task and claude's step-by-step thought process are important to keep in context)
	const newMessages = [...messages]
	let index = 2
	while (totalMessageTokens > availableTokens && index < newMessages.length) {
		const messageToEmpty = newMessages[index]
		const originalTokens = countMessageTokens(messageToEmpty)
		// Empty the content of the message (messages must be in a specific order so we can't just remove)
		if (typeof messageToEmpty.content === "string") {
			messageToEmpty.content = ""
		} else if (Array.isArray(messageToEmpty.content)) {
			messageToEmpty.content = messageToEmpty.content.map((item) => {
				if (typeof item === "string") {
					return {
						type: "text",
						text: "(truncated due to context window)",
					} as Anthropic.Messages.TextBlockParam
				} else if (item.type === "text") {
					return {
						type: "text",
						text: "(truncated due to context window)",
					} as Anthropic.Messages.TextBlockParam
				} else if (item.type === "image") {
					return { ...item, source: { type: "base64", data: "" } } as Anthropic.Messages.ImageBlockParam
				} else if (item.type === "tool_use") {
					return { ...item, input: {} } as Anthropic.Messages.ToolUseBlockParam
				} else if (item.type === "tool_result") {
					return {
						...item,
						content: Array.isArray(item.content)
							? item.content.map((contentItem) =>
									contentItem.type === "text"
										? { ...contentItem, text: "(truncated due to context window)" }
										: contentItem.type === "image"
										? { ...contentItem, source: { type: "base64", data: "" } }
										: contentItem
							  )
							: "",
					} as Anthropic.Messages.ToolResultBlockParam
				}
				return item
			})
		}
		const newTokens = countMessageTokens(messageToEmpty)
		totalMessageTokens -= originalTokens - newTokens
		index++
	}
	return newMessages
}

function countMessageTokens(message: Anthropic.Messages.MessageParam): number {
	if (typeof message.content === "string") {
		return countTokens(message.content)
	} else {
		return countTokens(JSON.stringify(message.content))
	}
}
