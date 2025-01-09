import { Anthropic } from "@anthropic-ai/sdk"

/*
We can't implement a dynamically updating sliding window as it would break prompt cache
every time. To maintain the benefits of caching, we need to keep conversation history
static. This operation should be performed as infrequently as possible. If a user reaches
a 200k context, we can assume that the first half is likely irrelevant to their current task.
Therefore, this function should only be called when absolutely necessary to fit within
context limits, not as a continuous process.
*/
export function truncateHalfConversation(
	messages: Anthropic.Messages.MessageParam[],
): Anthropic.Messages.MessageParam[] {
	// API expects messages to be in user-assistant order, and tool use messages must be followed by tool results. We need to maintain this structure while truncating.

	// Always keep the first Task message (this includes the project's file structure in environment_details)
	const truncatedMessages = [messages[0]]

	// Remove half of user-assistant pairs
	const messagesToRemove = Math.floor(messages.length / 4) * 2 // has to be even number

	const remainingMessages = messages.slice(messagesToRemove + 1) // has to start with assistant message since tool result cannot follow assistant message with no tool use
	truncatedMessages.push(...remainingMessages)

	return truncatedMessages
}
