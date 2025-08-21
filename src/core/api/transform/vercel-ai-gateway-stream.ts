import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo } from "@shared/api"
import OpenAI from "openai"
import { convertToOpenAiMessages } from "../transform/openai-format"

export async function createVercelAIGatewayStream(
	client: OpenAI,
	systemPrompt: string,
	messages: Anthropic.Messages.MessageParam[],
	model: { id: string; info: ModelInfo },
) {
	// Convert Anthropic messages to OpenAI format
	const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
		{ role: "system", content: systemPrompt },
		...convertToOpenAiMessages(messages),
	]

	const isAnthropicModel = model.id.startsWith("anthropic/")

	if (isAnthropicModel && model.info.supportsPromptCache) {
		openAiMessages[0] = {
			role: "system",
			content: systemPrompt,
			// @ts-ignore-next-line
			cache_control: { type: "ephemeral" },
		}

		// Add cache_control to the last two user messages for conversation context caching
		const lastTwoUserMessages = openAiMessages.filter((msg) => msg.role === "user").slice(-2)
		lastTwoUserMessages.forEach((msg) => {
			if (typeof msg.content === "string" && msg.content.length > 0) {
				msg.content = [{ type: "text", text: msg.content }]
			}
			if (Array.isArray(msg.content)) {
				// Find the last text part in the message content
				const lastTextPart = msg.content.filter((part) => part.type === "text").pop()

				if (lastTextPart && lastTextPart.text && lastTextPart.text.length > 0) {
					// @ts-ignore-next-line
					lastTextPart["cache_control"] = { type: "ephemeral" }
				}
			}
		})
	}

	const stream = await client.chat.completions.create({
		model: model.id,
		max_tokens: model.info.maxTokens,
		temperature: 0.7,
		messages: openAiMessages,
		stream: true,
	})

	return stream
}
