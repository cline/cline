import { Anthropic } from "@anthropic-ai/sdk"

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
 * exceeds the model's limit.
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - The conversation messages.
 * @param {number} totalTokens - The total number of tokens in the conversation.
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
	const allowedTokens = contextWindow - (maxTokens || contextWindow * 0.2)
	return totalTokens < allowedTokens ? messages : truncateConversation(messages, 0.5)
}
