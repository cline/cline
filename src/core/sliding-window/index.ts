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
 * Depending on whether the model supports prompt caching, different maximum token thresholds
 * and truncation fractions are used. If the current total tokens exceed the threshold,
 * the conversation is truncated using the appropriate fraction.
 *
 * @param {Anthropic.Messages.MessageParam[]} messages - The conversation messages.
 * @param {number} totalTokens - The total number of tokens in the conversation.
 * @param {ModelInfo} modelInfo - Model metadata including context window size and prompt cache support.
 * @returns {Anthropic.Messages.MessageParam[]} The original or truncated conversation messages.
 */
export function truncateConversationIfNeeded(
	messages: Anthropic.Messages.MessageParam[],
	totalTokens: number,
	modelInfo: ModelInfo,
): Anthropic.Messages.MessageParam[] {
	if (modelInfo.supportsPromptCache) {
		return totalTokens < getMaxTokensForPromptCachingModels(modelInfo)
			? messages
			: truncateConversation(messages, getTruncFractionForPromptCachingModels(modelInfo))
	} else {
		return totalTokens < getMaxTokensForNonPromptCachingModels(modelInfo)
			? messages
			: truncateConversation(messages, getTruncFractionForNonPromptCachingModels(modelInfo))
	}
}

/**
 * Calculates the maximum allowed tokens for models that support prompt caching.
 *
 * The maximum is computed as the greater of (contextWindow - 40000) and 80% of the contextWindow.
 *
 * @param {ModelInfo} modelInfo - The model information containing the context window size.
 * @returns {number} The maximum number of tokens allowed for prompt caching models.
 */
function getMaxTokensForPromptCachingModels(modelInfo: ModelInfo): number {
	return Math.max(modelInfo.contextWindow - 40_000, modelInfo.contextWindow * 0.8)
}

/**
 * Provides the fraction of messages to remove for models that support prompt caching.
 *
 * @param {ModelInfo} modelInfo - The model information (unused in current implementation).
 * @returns {number} The truncation fraction for prompt caching models (fixed at 0.5).
 */
function getTruncFractionForPromptCachingModels(modelInfo: ModelInfo): number {
	return 0.5
}

/**
 * Calculates the maximum allowed tokens for models that do not support prompt caching.
 *
 * The maximum is computed as the greater of (contextWindow - 40000) and 80% of the contextWindow.
 *
 * @param {ModelInfo} modelInfo - The model information containing the context window size.
 * @returns {number} The maximum number of tokens allowed for non-prompt caching models.
 */
function getMaxTokensForNonPromptCachingModels(modelInfo: ModelInfo): number {
	return Math.max(modelInfo.contextWindow - 40_000, modelInfo.contextWindow * 0.8)
}

/**
 * Provides the fraction of messages to remove for models that do not support prompt caching.
 *
 * @param {ModelInfo} modelInfo - The model information.
 * @returns {number} The truncation fraction for non-prompt caching models (fixed at 0.1).
 */
function getTruncFractionForNonPromptCachingModels(modelInfo: ModelInfo): number {
	return Math.min(40_000 / modelInfo.contextWindow, 0.2)
}
