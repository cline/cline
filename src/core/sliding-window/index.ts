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

	// Calculate token count
	let totalTokens = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0)
	
	// If under limit, return all messages
	if (totalTokens <= 65536) {
		return messages
	}

	// Remove least important messages first
	const importantMessages = messages.filter(msg => {
		// Keep messages with tool results
		if ((msg as any).role === 'tool') return true
		// Keep messages with file content
		if (typeof msg.content === 'string' && msg.content.includes('file_content')) return true
		// Keep messages with environment details
		if (typeof msg.content === 'string' && msg.content.includes('environment_details')) return true
		return false
	})

	// Add important messages first
	truncatedMessages.push(...importantMessages)

	// Calculate remaining tokens
	let remainingTokens = 65536 - truncatedMessages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0)

	// Add remaining messages until token limit
	for (let i = 1; i < messages.length; i++) {
		const msg = messages[i]
		const msgTokens = msg.content?.length || 0
		
		if (remainingTokens - msgTokens >= 0) {
			truncatedMessages.push(msg)
			remainingTokens -= msgTokens
		} else {
			break
		}
	}

	return truncatedMessages
}
