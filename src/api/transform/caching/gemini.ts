import OpenAI from "openai"

export function addCacheBreakpoints(
	systemPrompt: string,
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
	frequency: number = 10,
) {
	// *Always* cache the system prompt.
	messages[0] = {
		role: "system",
		// @ts-ignore-next-line
		content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
	}

	// Add breakpoints every N user messages based on frequency.
	let count = 0

	for (const msg of messages) {
		if (msg.role !== "user") {
			continue
		}

		// Ensure content is in array format for potential modification.
		if (typeof msg.content === "string") {
			msg.content = [{ type: "text", text: msg.content }]
		}

		const isNthMessage = count % frequency === frequency - 1

		if (isNthMessage) {
			if (Array.isArray(msg.content)) {
				// Find the last text part to add the cache control to.
				let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

				if (!lastTextPart) {
					lastTextPart = { type: "text", text: "..." } // Add a placeholder if no text part exists.
					msg.content.push(lastTextPart)
				}

				// @ts-ignore-next-line - Add cache control property
				lastTextPart["cache_control"] = { type: "ephemeral" }
			}
		}

		count++
	}
}
