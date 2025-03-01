import { Anthropic } from "@anthropic-ai/sdk"

import { Tiktoken } from "js-tiktoken/lite"
import o200kBase from "js-tiktoken/ranks/o200k_base"

export const TOKEN_FUDGE_FACTOR = 1.5
export const TOKEN_BUFFER = 5000

/**
 * Counts tokens for user content using tiktoken for text
 * and a size-based calculation for images.
 *
 * @param {Array<Anthropic.Messages.ContentBlockParam>} content - The content to count tokens for
 * @returns {number} The token count
 */
export function estimateTokenCount(content: Array<Anthropic.Messages.ContentBlockParam>): number {
	if (!content || content.length === 0) return 0

	let totalTokens = 0
	let encoder = null

	// Create encoder
	encoder = new Tiktoken(o200kBase)

	// Process each content block
	for (const block of content) {
		if (block.type === "text") {
			// Use tiktoken for text token counting
			const text = block.text || ""
			if (text.length > 0) {
				const tokens = encoder.encode(text)
				totalTokens += tokens.length
			}
		} else if (block.type === "image") {
			// For images, calculate based on data size
			const imageSource = block.source
			if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
				const base64Data = imageSource.data as string
				totalTokens += Math.ceil(Math.sqrt(base64Data.length))
			} else {
				totalTokens += 300 // Conservative estimate for unknown images
			}
		}
	}

	// Add a fudge factor to account for the fact that tiktoken is not always accurate
	return Math.ceil(totalTokens * TOKEN_FUDGE_FACTOR)
}

/**
 * Truncates a conversation by removing a fraction of the messages.
 *
 * The first message is always retained, and a specified fraction (rounded to an even number)
 * of messages from the beginning (excluding the first) is removed.
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - The conversation messages.
 * @param {number} fracToRemove - The fraction (between 0 and 1) of messages (excluding the first) to remove.
 * @returns {Anthropic.Messages.MessageParam[]} The truncated conversation messages.
 */
export function truncateConversation(
	messages: Anthropic.Messages.MessageParam[],
	fracToRemove: number,
): Anthropic.Messages.MessageParam[] {
	const truncatedMessages = [messages[0]]
	const rawMessagesToRemove = Math.floor((messages.length - 1) * fracToRemove)
	const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2)
	const remainingMessages = messages.slice(messagesToRemove + 1)
	truncatedMessages.push(...remainingMessages)

	return truncatedMessages
}

/**
 * Conditionally truncates the conversation messages if the total token count
 * exceeds the model's limit, considering the size of incoming content.
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - The conversation messages.
 * @param {number} totalTokens - The total number of tokens in the conversation (excluding the last user message).
 * @param {number} contextWindow - The context window size.
 * @param {number} maxTokens - The maximum number of tokens allowed.
 * @returns {Anthropic.Messages.MessageParam[]} The original or truncated conversation messages.
 */

type TruncateOptions = {
	messages: Anthropic.Messages.MessageParam[]
	totalTokens: number
	contextWindow: number
	maxTokens?: number
}

export function truncateConversationIfNeeded({
	messages,
	totalTokens,
	contextWindow,
	maxTokens,
}: TruncateOptions): Anthropic.Messages.MessageParam[] {
	// Calculate the maximum tokens reserved for response
	const reservedTokens = maxTokens || contextWindow * 0.2

	// Estimate tokens for the last message (which is always a user message)
	const lastMessage = messages[messages.length - 1]
	const lastMessageContent = lastMessage.content
	const lastMessageTokens = Array.isArray(lastMessageContent)
		? estimateTokenCount(lastMessageContent)
		: estimateTokenCount([{ type: "text", text: lastMessageContent as string }])

	// Calculate total effective tokens (totalTokens never includes the last message)
	const effectiveTokens = totalTokens + lastMessageTokens

	// Calculate available tokens for conversation history
	const allowedTokens = contextWindow - reservedTokens

	// Determine if truncation is needed and apply if necessary
	// Truncate if we're within TOKEN_BUFFER of the limit
	return effectiveTokens > allowedTokens - TOKEN_BUFFER ? truncateConversation(messages, 0.5) : messages
}
