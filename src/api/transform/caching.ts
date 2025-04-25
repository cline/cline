import OpenAI from "openai"

export const addCacheControlDirectives = (systemPrompt: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
	messages[0] = {
		role: "system",
		content: [
			{
				type: "text",
				text: systemPrompt,
				// @ts-ignore-next-line
				cache_control: { type: "ephemeral" },
			},
		],
	}

	messages
		.filter((msg) => msg.role === "user")
		.slice(-2)
		.forEach((msg) => {
			if (typeof msg.content === "string") {
				msg.content = [{ type: "text", text: msg.content }]
			}

			if (Array.isArray(msg.content)) {
				let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

				if (!lastTextPart) {
					lastTextPart = { type: "text", text: "..." }
					msg.content.push(lastTextPart)
				}

				// @ts-ignore-next-line
				lastTextPart["cache_control"] = { type: "ephemeral" }
			}
		})
}
