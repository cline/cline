import { Anthropic } from "@anthropic-ai/sdk" // for Anthropic.Messages.MessageParam types
import { Groq } from 'groq-sdk';
import { ApiHandler } from "../index"
import { ApiHandlerOptions, GroqModelId, groqDefaultModelId, groqModels, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"

export class GroqHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: Groq

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new Groq({
			apiKey: this.options.groqApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Convert Anthropic-style messages to an OpenAI-like format
		const openAiMessages = [
			{ role: "system", content: systemPrompt },
			...convertToOpenAiMessages(messages),
		]

		// Filter out invalid roles (e.g., "tool", "function") and ensure `content` is a string
		const groqMessages = openAiMessages
			.filter((msg) => ["system", "user", "assistant"].includes(msg.role))
			.map((msg) => {
				const finalContent =
					typeof msg.content === "string"
						? msg.content
						: JSON.stringify(msg.content)
				return {
					role: msg.role as "system" | "user" | "assistant",
					content: finalContent,
				}
			})

		const { id: modelId } = this.getModel()

		// Make the streaming request to Groq
		const response = await this.client.chat.completions.create({
			model: modelId,
			messages: groqMessages,
			stream: true,
			// Additional Groq parameters if desired, e.g. temperature, max_completion_tokens, etc.
		})

		for await (const chunk of response) {
			const delta = chunk.choices?.[0]?.delta
			if (delta?.content) {
				yield {
					type: "text",
					text: delta.content,
				}
			}
			// If usage data is available from Groq, yield usage chunks as well:
			// if (chunk.usage) {
			//   yield {
			//     type: "usage",
			//     inputTokens: chunk.usage.prompt_tokens ?? 0,
			//     outputTokens: chunk.usage.completion_tokens ?? 0
			//   }
			// }
		}
	}

	getModel(): { id: GroqModelId; info: ModelInfo } {
		const modelId = this.options.groqModelId
		if (modelId && modelId in groqModels) {
			const id = modelId as GroqModelId
			return { id, info: groqModels[id] }
		}
		return {
			id: groqDefaultModelId,
			info: groqModels[groqDefaultModelId],
		}
	}
}