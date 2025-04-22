import { Anthropic } from "@anthropic-ai/sdk"
import type {
	Content,
	Part,
	TextPart,
	InlineDataPart,
	GenerateContentResponse,
} from "@google-cloud/vertexai"

export function convertAnthropicContentToGemini(content: string | Anthropic.ContentBlockParam[]): Part[] {
	if (typeof content === "string") {
		return [{ text: content } as TextPart]
	}
	return content.flatMap((block) => {
		switch (block.type) {
			case "text":
				return { text: block.text } as TextPart
			case "image":
				if (block.source.type !== "base64") {
					throw new Error("Unsupported image source type")
				}
				return {
					inlineData: {
						data: block.source.data,
						mimeType: block.source.media_type,
					},
				} as InlineDataPart
			default:
				throw new Error(`Unsupported content block type: ${block.type}`)
		}
	})
}

export function convertAnthropicMessageToGemini(message: Anthropic.Messages.MessageParam): Content {
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToGemini(message.content),
	}
}

export function unescapeGeminiContent(content: string) {
	return content.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\r/g, "\r").replace(/\\t/g, "\t")
}

export function convertGeminiResponseToAnthropic(response: GenerateContentResponse): Anthropic.Messages.Message {
	const content: Anthropic.Messages.ContentBlock[] = []

	const parts = response.candidates?.[0]?.content?.parts || []
	for (const part of parts) {
		if ("text" in part && part.text) {
			content.push({ type: "text", text: part.text, citations: null })
		}
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
		}
	}

	return {
		id: `msg_${Date.now()}`, // Generate a unique ID
		type: "message",
		role: "assistant",
		content,
		model: "",
		stop_reason,
		stop_sequence: null, // Gemini doesn't provide this information
		usage: {
			input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
			output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
			cache_creation_input_tokens: null,
			cache_read_input_tokens: null,
		},
	}
}
