import { Anthropic } from "@anthropic-ai/sdk"
import { countTokens } from "@anthropic-ai/tokenizer"
import { Buffer } from "buffer"
import sizeOf from "image-size"

export function isWithinContextWindow(
	contextWindow: number,
	systemPrompt: string,
	tools: Anthropic.Messages.Tool[],
	messages: Anthropic.Messages.MessageParam[]
): boolean {
	const adjustedContextWindow = contextWindow * 0.75 // Buffer to account for tokenizer differences
	// counting tokens is expensive, so we first try to estimate before doing a more accurate calculation
	const estimatedTotalMessageTokens = countTokens(systemPrompt + JSON.stringify(tools) + JSON.stringify(messages))
	if (estimatedTotalMessageTokens <= adjustedContextWindow) {
		return true
	}
	const systemPromptTokens = countTokens(systemPrompt)
	const toolsTokens = countTokens(JSON.stringify(tools))
	let availableTokens = adjustedContextWindow - systemPromptTokens - toolsTokens
	let accurateTotalMessageTokens = messages.reduce((sum, message) => sum + countMessageTokens(message), 0)
	return accurateTotalMessageTokens <= availableTokens
}

/*
We can't implement a dynamically updating sliding window as it would break prompt cache
every time. To maintain the benefits of caching, we need to keep conversation history
static. This operation should be performed as infrequently as possible. If a user reaches
a 200k context, we can assume that the first half is likely irrelevant to their current task.
Therefore, this function should only be called when absolutely necessary to fit within
context limits, not as a continuous process.
*/
export function truncateHalfConversation(
	messages: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
	// API expects messages to be in user-assistant order, and tool use messages must be followed by tool results. We need to maintain this structure while truncating.

	// Always keep the first Task message (this includes the project's file structure in potentially_relevant_details)
	const truncatedMessages = [messages[0]]

	// Remove half of user-assistant pairs
	const messagesToRemove = Math.floor(messages.length / 4) * 2 // has to be even number

	const remainingMessages = messages.slice(messagesToRemove + 1) // has to start with assistant message since tool result cannot follow assistant message with no tool use
	truncatedMessages.push(...remainingMessages)

	return truncatedMessages
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
