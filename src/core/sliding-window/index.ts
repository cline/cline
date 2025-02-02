import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo } from "../../shared/api"
import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs"

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
