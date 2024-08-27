import { Anthropic } from "@anthropic-ai/sdk"
import { countTokens } from "@anthropic-ai/tokenizer"
import { Buffer } from "buffer"
import sizeOf from "image-size"
import cloneDeep from "clone-deep"

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
	const newMessages = cloneDeep(messages) // since we're manipulating nested objects and arrays, need to deep clone to prevent mutating original history
	let index = 2
	while (totalMessageTokens > availableTokens && index < newMessages.length) {
		const messageToEmpty = newMessages[index]
		const originalTokens = countMessageTokens(messageToEmpty)
		// Empty the content of the message (messages must be in a specific order so we can't just remove)
		if (typeof messageToEmpty.content === "string") {
			messageToEmpty.content = "(truncated due to context limits)"
		} else if (Array.isArray(messageToEmpty.content)) {
			messageToEmpty.content = messageToEmpty.content.map((item) => {
				if (typeof item === "string") {
					return {
						type: "text",
						text: "(truncated due to context limits)",
					} as Anthropic.Messages.TextBlockParam
				} else if (item.type === "text") {
					return {
						type: "text",
						text: "(truncated due to context limits)",
					} as Anthropic.Messages.TextBlockParam
				} else if (item.type === "image") {
					return {
						type: "text",
						text: "(image removed due to context limits)",
					} as Anthropic.Messages.TextBlockParam
				} else if (item.type === "tool_use") {
					return { ...item, input: {} } as Anthropic.Messages.ToolUseBlockParam
				} else if (item.type === "tool_result") {
					return {
						...item,
						content: Array.isArray(item.content)
							? item.content.map((contentItem) =>
									contentItem.type === "text"
										? { type: "text", text: "(truncated due to context limits)" }
										: contentItem.type === "image"
										? { type: "text", text: "(image removed due to context limits)" }
										: contentItem
							  )
							: "(truncated due to context limits)",
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
	} else if (Array.isArray(message.content)) {
		return message.content.reduce((sum, item) => {
			if (typeof item === "string") {
				return sum + countTokens(item)
			} else if (item.type === "text") {
				return sum + countTokens(item.text)
			} else if (item.type === "image") {
				return sum + estimateImageTokens(item.source.data)
			} else if (item.type === "tool_use") {
				return sum + countTokens(JSON.stringify(item.input))
			} else if (item.type === "tool_result") {
				if (Array.isArray(item.content)) {
					return (
						sum +
						item.content.reduce((contentSum, contentItem) => {
							if (contentItem.type === "text") {
								return contentSum + countTokens(contentItem.text)
							} else if (contentItem.type === "image") {
								return contentSum + estimateImageTokens(contentItem.source.data)
							}
							return contentSum + countTokens(JSON.stringify(contentItem))
						}, 0)
					)
				} else {
					return sum + countTokens(item.content || "")
				}
			} else {
				return sum + countTokens(JSON.stringify(item))
			}
		}, 0)
	} else {
		return countTokens(JSON.stringify(message.content))
	}
}

function estimateImageTokens(base64: string): number {
	const base64Data = base64.split(";base64,").pop()
	if (base64Data) {
		const buffer = Buffer.from(base64Data, "base64")
		const dimensions = sizeOf(buffer)
		if (dimensions.width && dimensions.height) {
			// "you can estimate the number of tokens used through this algorithm: tokens = (width px * height px)/750"
			return Math.ceil((dimensions.width * dimensions.height) / 750)
		}
	}
	return countTokens(base64)
}
