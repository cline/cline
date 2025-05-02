import { Anthropic } from "@anthropic-ai/sdk"

export function addCacheBreakpoints(messages: Anthropic.Messages.MessageParam[]) {
	// Find indices of user messages that we want to cache.
	// We only cache the last two user messages to stay within the 4-block limit
	// (1 block for system + 1 block each for last two user messages = 3 total).
	const indices = messages.reduce((acc, msg, i) => (msg.role === "user" ? [...acc, i] : acc), [] as number[])

	// Only cache the last two user messages.
	const lastIndex = indices[indices.length - 1] ?? -1
	const secondLastIndex = indices[indices.length - 2] ?? -1

	return messages.map((message, index) =>
		message.role !== "assistant" && (index === lastIndex || index === secondLastIndex)
			? cachedMessage(message)
			: message,
	)
}

function cachedMessage(message: Anthropic.Messages.MessageParam): Anthropic.Messages.MessageParam {
	// For string content, we convert to array format with optional cache control.
	if (typeof message.content === "string") {
		return {
			...message,
			// For string content, we only have one block so it's always the last block.
			content: [{ type: "text" as const, text: message.content, cache_control: { type: "ephemeral" } }],
		}
	}

	// For array content, find the last text block index once before mapping.
	const lastTextBlockIndex = message.content.reduce(
		(lastIndex, content, index) => (content.type === "text" ? index : lastIndex),
		-1,
	)

	// Then use this pre-calculated index in the map function.
	return {
		...message,
		content: message.content.map((content, index) =>
			content.type === "text"
				? {
						...content,
						// Check if this is the last text block using our pre-calculated index.
						...(index === lastTextBlockIndex && { cache_control: { type: "ephemeral" } }),
					}
				: content,
		),
	}
}
