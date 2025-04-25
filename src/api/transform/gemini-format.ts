import { Anthropic } from "@anthropic-ai/sdk"
import type {
	Content,
	Part,
	TextPart,
	InlineDataPart,
	GenerateContentResponse as VertexGenerateContentResponse,
} from "@google-cloud/vertexai"
import type {
	Content as GenAIContent,
	Part as GenAIPart,
	GenerateContentResponse as GenAIGenerateContentResponse,
} from "@google/generative-ai"

export function convertAnthropicContentToVertexContent(content: string | Anthropic.ContentBlockParam[]): Part[] {
	if (typeof content === "string") {
		return [{ text: content } as TextPart]
	}
	return content.flatMap((block): Part => {
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

export function convertAnthropicMessageToVertexContent(message: Anthropic.Messages.MessageParam): Content {
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToVertexContent(message.content),
	}
}

// --- Duplicate functions for @google/generative-ai ---

export function convertAnthropicContentToGenerativeAiContent(content: string | Anthropic.ContentBlockParam[]): GenAIPart[] {
	if (typeof content === "string") {
		return [{ text: content }]
	}
	return content.flatMap((block): GenAIPart => {
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

export function convertAnthropicMessageToGenerativeAiContent(message: Anthropic.Messages.MessageParam): GenAIContent {
	const role = message.role === "assistant" ? "model" : "user"
	if (role !== "user" && role !== "model") {
		throw new Error(`Unsupported role conversion: ${message.role}`)
	}
	return {
		role: role,
		parts: convertAnthropicContentToGenerativeAiContent(message.content),
	}
}

// --- End of duplicate functions ---

export function unescapeGeminiContent(content: string) {
	return content.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\r/g, "\r").replace(/\\t/g, "\t")
}

export function convertVertexResponseToAnthropic(response: VertexGenerateContentResponse): Anthropic.Messages.Message {
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
		id: `msg_${Date.now()}`,
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
