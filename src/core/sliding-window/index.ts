import { Anthropic } from "@anthropic-ai/sdk"

import { ModelInfo } from "../../shared/api"

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
 * Conditionally truncates the conversation messages if the total token count exceeds the model's limit.
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - The conversation messages.
 * @param {number} totalTokens - The total number of tokens in the conversation.
 * @param {ModelInfo} modelInfo - Model metadata including context window size.
 * @returns {Anthropic.Messages.MessageParam[]} The original or truncated conversation messages.
 */
export function truncateConversationIfNeeded(
	messages: Anthropic.Messages.MessageParam[],
	totalTokens: number,
	modelInfo: ModelInfo,
): Anthropic.Messages.MessageParam[] {
	return totalTokens < getMaxTokens(modelInfo) ? messages : truncateConversation(messages, 0.5)
}

/**
 * Calculates the maximum allowed tokens
 *
 * @param {ModelInfo} modelInfo - The model information containing the context window size.
 * @returns {number} The maximum number of tokens allowed
 */
function getMaxTokens(modelInfo: ModelInfo): number {
	// The buffer needs to be at least as large as `modelInfo.maxTokens`, or 20% of the context window if for some reason it's not set.
	return modelInfo.contextWindow - Math.max(modelInfo.maxTokens || modelInfo.contextWindow * 0.2)
}
