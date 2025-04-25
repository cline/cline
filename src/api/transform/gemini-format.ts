import { Anthropic } from "@anthropic-ai/sdk"
// Import types from @google/generative-ai
import { Content, GenerateContentResponse, Part } from "@google/generative-ai"

// Conversion functions using @google/generative-ai types

export function convertAnthropicContentToGemini(content: string | Anthropic.ContentBlockParam[]): Part[] {
	if (typeof content === "string") {
		return [{ text: content }]
	}
	return content.flatMap((block): Part => {
		switch (block.type) {
			case "text":
				return { text: block.text }
			case "image":
				if (block.source.type !== "base64") {
					throw new Error("Unsupported image source type")
				}
				return {
					inlineData: {
						data: block.source.data,
						mimeType: block.source.media_type,
					},
				}
			default:
				throw new Error(`Unsupported content block type: ${block.type}`)
		}
	})
}

export function convertAnthropicMessageToGemini(message: Anthropic.Messages.MessageParam): Content {
	const role = message.role === "assistant" ? "model" : "user"
	if (role !== "user" && role !== "model") {
		throw new Error(`Unsupported role conversion: ${message.role}`)
	}
	return {
		role: role,
		parts: convertAnthropicContentToGemini(message.content),
	}
}

export function unescapeGeminiContent(content: string) {
	return content.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\r/g, "\r").replace(/\\t/g, "\t")
}

// Function for converting @google/generative-ai response
export function convertGeminiResponseToAnthropic(response: GenerateContentResponse): Anthropic.Messages.Message {
	const content: Anthropic.Messages.ContentBlock[] = []

	// Correctly iterate through parts to extract text, instead of using response.text
	const parts = response.candidates?.[0]?.content?.parts || []
	for (const part of parts) {
		if ("text" in part && part.text) {
			// Accumulate text from potentially multiple parts
			const lastBlock = content[content.length - 1]
			if (lastBlock?.type === "text") {
				lastBlock.text += part.text // Append to existing text block if possible
			} else {
				content.push({ type: "text", text: part.text, citations: null })
			}
		}
		// TODO: Handle other part types if necessary (e.g., function calls)
	}

	let stop_reason: Anthropic.Messages.Message["stop_reason"] = null
	const finishReason = response.candidates?.[0]?.finishReason
	if (finishReason) {
		switch (finishReason) {
			case "STOP":
				stop_reason = "end_turn"
				break
			case "MAX_TOKENS":
				stop_reason = "max_tokens"
				break
			default:
				stop_reason = "stop_sequence"
				break // Corrected break based on main branch conflict
		}
	}

	// Ensure usage keys match the target Anthropic type (snake_case based on error)
	return {
		id: `msg_${Date.now()}`,
		type: "message",
		role: "assistant",
		content,
		model: "",
		stop_reason,
		stop_sequence: null,
		usage: {
			input_tokens: response.usageMetadata?.promptTokenCount ?? 0, // Use snake_case
			output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0, // Use snake_case
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	}
}
