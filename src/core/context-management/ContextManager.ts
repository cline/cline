import { Anthropic } from "@anthropic-ai/sdk"
import { ClineApiReqInfo, ClineMessage } from "../../shared/ExtensionMessage"
import { ApiHandler } from "../../api"
import { OpenAiHandler } from "../../api/providers/openai"
import { formatResponse } from "../prompts/responses"

export class ContextManager {
	getNewContextMessagesAndMetadata(
		apiConversationHistory: Anthropic.Messages.MessageParam[],
		clineMessages: ClineMessage[],
		api: ApiHandler,
		conversationHistoryDeletedRange: [number, number] | undefined,
		previousApiReqIndex: number,
	) {
		let updatedConversationHistoryDeletedRange = false

		// If the previous API request's total token usage is close to the context window, truncate the conversation history to free up space for the new request
		if (previousApiReqIndex >= 0) {
			const previousRequest = clineMessages[previousApiReqIndex]
			if (previousRequest && previousRequest.text) {
				const { tokensIn, tokensOut, cacheWrites, cacheReads }: ClineApiReqInfo = JSON.parse(previousRequest.text)
				const totalTokens = (tokensIn || 0) + (tokensOut || 0) + (cacheWrites || 0) + (cacheReads || 0)
				let contextWindow = api.getModel().info.contextWindow || 128_000
				// FIXME: hack to get anyone using openai compatible with deepseek to have the proper context window instead of the default 128k. We need a way for the user to specify the context window for models they input through openai compatible
				if (api instanceof OpenAiHandler && api.getModel().id.toLowerCase().includes("deepseek")) {
					contextWindow = 64_000
				}
				let maxAllowedSize: number
				switch (contextWindow) {
					case 64_000: // deepseek models
						maxAllowedSize = contextWindow - 27_000
						break
					case 128_000: // most models
						maxAllowedSize = contextWindow - 30_000
						break
					case 200_000: // claude models
						maxAllowedSize = contextWindow - 40_000
						break
					default:
						maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8) // for deepseek, 80% of 64k meant only ~10k buffer which was too small and resulted in users getting context window errors.
				}

				// This is the most reliable way to know when we're close to hitting the context window.
				if (totalTokens >= maxAllowedSize) {
					// Since the user may switch between models with different context windows, truncating half may not be enough (ie if switching from claude 200k to deepseek 64k, half truncation will only remove 100k tokens, but we need to remove much more)
					// So if totalTokens/2 is greater than maxAllowedSize, we truncate 3/4 instead of 1/2
					// FIXME: truncating the conversation in a way that is optimal for prompt caching AND takes into account multi-context window complexity is something we need to improve
					const keep = totalTokens / 2 > maxAllowedSize ? "quarter" : "half"

					// NOTE: it's okay that we overwriteConversationHistory in resume task since we're only ever removing the last user message and not anything in the middle which would affect this range
					conversationHistoryDeletedRange = this.getNextTruncationRange(
						apiConversationHistory,
						conversationHistoryDeletedRange,
						keep,
					)

					updatedConversationHistoryDeletedRange = true
				}
			}
		}

		// conversationHistoryDeletedRange is updated only when we're close to hitting the context window, so we don't continuously break the prompt cache
		const truncatedConversationHistory = this.getAndAlterTruncatedMessages(
			apiConversationHistory,
			conversationHistoryDeletedRange,
		)

		return {
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
			updatedConversationHistoryDeletedRange: updatedConversationHistoryDeletedRange,
			truncatedConversationHistory: truncatedConversationHistory,
		}
	}

	private getNextTruncationRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined,
		keep: "half" | "quarter",
	): [number, number] {
		// We always keep the first user-assistant pairing, and truncate an even number of messages from there
		const rangeStartIndex = 2 // index 0 and 1 are kept
		const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 2 // inclusive starting index

		let messagesToRemove: number
		if (keep === "half") {
			// Remove half of user-assistant pairs
			messagesToRemove = Math.floor((apiMessages.length - startOfRest) / 4) * 2 // Keep even number
		} else {
			// Remove 3/4 of user-assistant pairs
			messagesToRemove = Math.floor((apiMessages.length - startOfRest) / 8) * 3 * 2
		}

		let rangeEndIndex = startOfRest + messagesToRemove - 1 // inclusive ending index

		// Make sure that the last message being removed is a assistant message, so the next message after the initial user-assistant pair is an assistant message. This preservers the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout cline)
		if (apiMessages[rangeEndIndex].role !== "assistant") {
			rangeEndIndex -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [rangeStartIndex, rangeEndIndex]
	}

	private getAndAlterTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		if (!deletedRange) {
			return messages
		}

		const [start, end] = deletedRange // inclusive range to ignore

		// need a deep copy
		const firstMessageChunk = JSON.parse(JSON.stringify(messages.slice(0, start)))
		if (Array.isArray(firstMessageChunk[1].content)) {
			// should always be the case
			firstMessageChunk[1].content[0].text = formatResponse.contextTruncationNotice()
		}

		// the range is inclusive - both start and end indices and everything in between will be removed from the final result.
		// NOTE: if you try to console log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
		return [...firstMessageChunk, ...messages.slice(end + 1)]
	}
}
