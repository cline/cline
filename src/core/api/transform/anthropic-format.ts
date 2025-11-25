import { Anthropic } from "@anthropic-ai/sdk"
import { ClineStorageMessage, convertClineStorageToAnthropicMessage } from "@/shared/messages/content"

/**
 * Converts Cline storage messages to Anthropic API format with optional cache control.
 * Adds ephemeral cache control to the last two user messages to prevent them from being
 * stored in Anthropic's cache.
 *
 * @param clineMessages - Array of Cline storage messages to convert
 * @param lastUserMsgIndex - Optional index of the last user message
 * @param secondLastMsgUserIndex - Optional index of the second-to-last user message
 * @returns Array of Anthropic-compatible messages with cache control applied
 */
export function sanitizeAnthropicMessages(
	clineMessages: Array<ClineStorageMessage | Anthropic.MessageParam>,
	supportCache: boolean,
): Array<Anthropic.MessageParam> {
	// The latest message will be the new user message, one before will be the assistant message from a previous request,
	// and the user message before that will be a previously cached user message. So we need to mark the latest user message
	// as ephemeral to cache it for the next request, and mark the second to last user message as ephemeral to let the server
	// know the last message to retrieve from the cache for the current request.
	const userMsgIndices = clineMessages.reduce((acc, msg, index) => {
		if (msg.role === "user") {
			acc.push(index)
		}
		return acc
	}, [] as number[])
	// Set to -1 if there are no user messages so the indices are invalid
	const indicesLength = userMsgIndices.length ?? -1
	const lastUserMsgIndex = userMsgIndices[indicesLength - 1]
	const secondLastMsgUserIndex = userMsgIndices[indicesLength - 2]

	return clineMessages.map((msg, index) => {
		const anthropicMsg = convertClineStorageToAnthropicMessage(msg)

		// Add cache control to the last two user messages
		if (supportCache && (index === lastUserMsgIndex || index === secondLastMsgUserIndex)) {
			return addCacheControl(anthropicMsg)
		}

		return anthropicMsg
	})
}

const isThinkingBlock = (
	block: Anthropic.ContentBlockParam,
): block is Anthropic.Messages.ThinkingBlockParam | Anthropic.Messages.RedactedThinkingBlockParam => {
	return block.type === "thinking" || block.type === "redacted_thinking"
}

/**
 * Adds ephemeral cache control to the last content block of a message.
 * Returns a new message object without mutating the original.
 *
 * @param message - The Anthropic message to add cache control to
 * @returns A new message with cache control added to the last content block
 */
function addCacheControl(message: Anthropic.MessageParam): Anthropic.MessageParam {
	// Convert string content to array format
	if (typeof message.content === "string") {
		return {
			...message,
			content: [
				{
					type: "text",
					text: message.content,
					cache_control: { type: "ephemeral" },
				} satisfies Anthropic.TextBlockParam,
			],
		}
	}

	// Handle array content - add cache control to the last block
	const content = [...message.content]
	const lastIndex = content.length - 1

	if (lastIndex >= 0) {
		const lastBlock = content[lastIndex]

		// Only add cache_control to block types that support it (not ThinkingBlockParam)
		if (!isThinkingBlock(lastBlock)) {
			content[lastIndex] = {
				...lastBlock,
				cache_control: { type: "ephemeral" },
			} satisfies Anthropic.ContentBlockParam
		}
	}

	return { ...message, content }
}
