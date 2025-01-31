import { Anthropic } from "@anthropic-ai/sdk"
<<<<<<< HEAD

/*
We can't implement a dynamically updating sliding window as it would break prompt cache
every time. To maintain the benefits of caching, we need to keep conversation history
static. This operation should be performed as infrequently as possible. If a user reaches
a 200k context, we can assume that the first half is likely irrelevant to their current task.
Therefore, this function should only be called when absolutely necessary to fit within
context limits, not as a continuous process.
*/
export function truncateHalfConversation(
=======
import { ModelInfo } from "../../shared/api"
import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs"

export function truncateConversation(
>>>>>>> 455d850c (Enable separate config for truncation for models without context caching)
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

export function truncateConversationIfNeeded(
	messages: MessageParam[],
	totalTokens: number,
	modelInfo: ModelInfo,
): MessageParam[] {
	if (modelInfo.supportsPromptCache) {
		return totalTokens < getMaxTokensForPromptCachingModels(modelInfo)
			? messages
			: truncateConversation(messages, getTruncFractionForPromptCachingModels(modelInfo))
	} else {
		const thresh = getMaxTokensForNonPromptCachingModels(modelInfo)
		return totalTokens < thresh
			? messages
			: truncateConversation(messages, getTruncFractionForNonPromptCachingModels(modelInfo))
	}
}

function getMaxTokensForPromptCachingModels(modelInfo: ModelInfo): number {
	return Math.max(modelInfo.contextWindow - 40_000, modelInfo.contextWindow * 0.8)
}

function getTruncFractionForPromptCachingModels(modelInfo: ModelInfo): number {
	return Math.min(80_000, modelInfo.contextWindow * 0.4)
}

function getMaxTokensForNonPromptCachingModels(modelInfo: ModelInfo): number {
	return Math.max(modelInfo.contextWindow - 40_000, modelInfo.contextWindow * 0.8)
}

function getTruncFractionForNonPromptCachingModels(modelInfo: ModelInfo): number {
	return Math.min(80_000, modelInfo.contextWindow * 0.4)
}
