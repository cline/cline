import { Anthropic } from "@anthropic-ai/sdk"

/*
We can't implement a dynamically updating sliding window as it would break prompt cache
every time. To maintain the benefits of caching, we need to keep conversation history
static. This operation should be performed as infrequently as possible. If a user reaches
a 200k context, we can assume that the first half is likely irrelevant to their current task.
Therefore, this function should only be called when absolutely necessary to fit within
context limits, not as a continuous process.
*/
// export function truncateHalfConversation(
// 	messages: Anthropic.Messages.MessageParam[],
// ): Anthropic.Messages.MessageParam[] {
// 	// API expects messages to be in user-assistant order, and tool use messages must be followed by tool results. We need to maintain this structure while truncating.

// 	// Always keep the first Task message (this includes the project's file structure in environment_details)
// 	const truncatedMessages = [messages[0]]

// 	// Remove half of user-assistant pairs
// 	const messagesToRemove = Math.floor(messages.length / 4) * 2 // has to be even number

// 	const remainingMessages = messages.slice(messagesToRemove + 1) // has to start with assistant message since tool result cannot follow assistant message with no tool use
// 	truncatedMessages.push(...remainingMessages)

// 	return truncatedMessages
// }

/*
getNextTruncationRange: Calculates the next range of messages to be "deleted"
- Takes the full messages array and optional current deleted range
- Always preserves the first message (task message)
- Removes 1/2 of remaining messages (rounded down to even number) after current deleted range
- Returns [startIndex, endIndex] representing inclusive range to delete

getTruncatedMessages: Constructs the truncated array using the deleted range
- Takes full messages array and optional deleted range
- Returns new array with messages in deleted range removed
- Preserves order and structure of remaining messages

The range is represented as [startIndex, endIndex] where both indices are inclusive
The functions maintain the original array integrity while allowing progressive truncation 
through the deletedRange parameter

Usage example:
const messages = [user1, assistant1, user2, assistant2, user3, assistant3];
let deletedRange = getNextTruncationRange(messages); // [1,2] (assistant1,user2)
let truncated = getTruncatedMessages(messages, deletedRange); 
// [user1, assistant2, user3, assistant3]

deletedRange = getNextTruncationRange(messages, deletedRange); // [2,3] (assistant2,user3) 
truncated = getTruncatedMessages(messages, deletedRange);
// [user1, assistant3]
*/

export function getNextTruncationRange(
	messages: Anthropic.Messages.MessageParam[],
	currentDeletedRange: [number, number] | undefined = undefined,
): [number, number] {
	// Since we always keep the first message, currentDeletedRange[0] will always be 1 (for now until we have a smarter truncation algorithm)
	const rangeStartIndex = 1
	const startOfRest = currentDeletedRange ? currentDeletedRange[1] + 1 : 1

	// Remove half of user-assistant pairs
	const messagesToRemove = Math.floor((messages.length - startOfRest) / 4) * 2 // Keep even number
	let rangeEndIndex = startOfRest + messagesToRemove - 1

	// Make sure the last message being removed is a user message, so that the next message after the initial task message is an assistant message. This preservers the user-assistant-user-assistant structure.
	// NOTE: anthropic format messages are always user-assitant-user-assistant, while openai format messages can have multiple user messages in a row (we use anthropic format throughout cline)
	if (messages[rangeEndIndex].role !== "user") {
		rangeEndIndex -= 1
	}

	// this is an inclusive range that will be removed from the conversation history
	return [rangeStartIndex, rangeEndIndex]
}

export function getTruncatedMessages(
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
