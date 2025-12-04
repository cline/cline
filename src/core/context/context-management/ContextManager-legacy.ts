import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandler } from "@core/api"
import { ClineApiReqInfo, ClineMessage } from "@shared/ExtensionMessage"
import { getContextWindowInfo } from "./context-window-utils"

// Legacy ContextManager - kept for reference during migration
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class ContextManagerLegacy {
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
				const { maxAllowedSize } = getContextWindowInfo(api)

				// This is the most reliable way to know when we're close to hitting the context window.
				if (totalTokens >= maxAllowedSize) {
					// Calculate optimal truncation strategy based on current usage vs target context window
					// Goal: Keep conversation within maxAllowedSize with buffer for new messages
					// Strategy: Adaptive truncation that accounts for model switching and prompt cache efficiency
					const utilizationRatio = totalTokens / maxAllowedSize

					// Determine how much to keep based on utilization:
					// - If slightly over (1.0-1.5x): Keep half (removes 50%)
					// - If moderately over (1.5-2.0x): Keep quarter (removes 75%)
					// - If severely over (2.0x+): Keep eighth (removes 87.5%)
					// This handles model switches better (e.g., Claude 200k → Deepseek 64k)
					let keep: "half" | "quarter" | "eighth"
					if (utilizationRatio >= 2.0) {
						keep = "eighth" // Very aggressive truncation for severe overflow
					} else if (utilizationRatio >= 1.5) {
						keep = "quarter" // Moderate truncation
					} else {
						keep = "half" // Standard truncation
					}

					console.log(
						`[ContextManager] Context window exceeded: ${totalTokens}/${maxAllowedSize} tokens ` +
							`(${(utilizationRatio * 100).toFixed(1)}% utilization). ` +
							`Truncation strategy: keep ${keep} of conversation.`,
					)

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
		const truncatedConversationHistory = this.getTruncatedMessages(apiConversationHistory, conversationHistoryDeletedRange)

		return {
			conversationHistoryDeletedRange: conversationHistoryDeletedRange,
			updatedConversationHistoryDeletedRange: updatedConversationHistoryDeletedRange,
			truncatedConversationHistory: truncatedConversationHistory,
		}
	}

	public getNextTruncationRange(
		apiMessages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined,
		keep: "half" | "quarter" | "eighth",
	): [number, number] {
		// Since we always keep the first message, currentDeletedRange[0] will always be 1 (for now until we have a smarter truncation algorithm)
		const rangeStartIndex = 1
		const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 1

		let messagesToRemove: number
		if (keep === "half") {
			// Remove half of remaining user-assistant pairs
			// We first calculate half of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor((apiMessages.length - startOfRest) / 4) * 2 // Keep even number
		} else if (keep === "quarter") {
			// Remove 3/4 of remaining user-assistant pairs
			// We calculate 3/4ths of the messages then divide by 2 to get the number of pairs.
			// After flooring, we multiply by 2 to get the number of messages.
			// Note that this will also always be an even number.
			messagesToRemove = Math.floor(((apiMessages.length - startOfRest) * 3) / 4 / 2) * 2
		} else {
			// keep === "eighth": Remove 7/8 of remaining user-assistant pairs
			// Very aggressive truncation for severe context window overflow
			// Calculate 7/8ths of messages, divide by 2 for pairs, floor and multiply by 2
			messagesToRemove = Math.floor(((apiMessages.length - startOfRest) * 7) / 8 / 2) * 2
		}

		let rangeEndIndex = startOfRest + messagesToRemove - 1

		// Make sure the last message being removed is a user message, so that the next message after the initial task message is an assistant message. This preservers the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout cline)
		if (apiMessages[rangeEndIndex].role !== "user") {
			rangeEndIndex -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [rangeStartIndex, rangeEndIndex]
	}

	public getTruncatedMessages(
		messages: Anthropic.Messages.MessageParam[],
		deletedRange: [number, number] | undefined,
	): Anthropic.Messages.MessageParam[] {
		if (!deletedRange) {
			return messages
		}

		const [start, end] = deletedRange
		// the range is inclusive - both start and end indices and everything in between will be removed from the final result.
		// NOTE: if you try to console log these, don't forget that logging a reference to an array may not provide the same result as logging a slice() snapshot of that array at that exact moment. The following DOES in fact include the latest assistant message.
		return [...messages.slice(0, start), ...messages.slice(end + 1)]
	}
}
