import { Anthropic } from "@anthropic-ai/sdk"

export class ContextManager {
	getNextTruncationRange(
		messages: Anthropic.Messages.MessageParam[],
		currentDeletedRange: [number, number] | undefined = undefined,
		keep: "half" | "quarter" = "half",
	): [number, number] {
		// Since we always keep the first message, currentDeletedRange[0] will always be 1 (for now until we have a smarter truncation algorithm)
		const rangeStartIndex = 1
		const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 1

		let messagesToRemove: number
		if (keep === "half") {
			// Remove half of user-assistant pairs
			messagesToRemove = Math.floor((messages.length - startOfRest) / 4) * 2 // Keep even number
		} else {
			// Remove 3/4 of user-assistant pairs
			messagesToRemove = Math.floor((messages.length - startOfRest) / 8) * 3 * 2
		}

		let rangeEndIndex = startOfRest + messagesToRemove - 1

		// Make sure the last message being removed is a user message, so that the next message after the initial task message is an assistant message. This preservers the user-assistant-user-assistant structure.
		// NOTE: anthropic format messages are always user-assistant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout cline)
		if (messages[rangeEndIndex].role !== "user") {
			rangeEndIndex -= 1
		}

		// this is an inclusive range that will be removed from the conversation history
		return [rangeStartIndex, rangeEndIndex]
	}

	getTruncatedMessages(
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
