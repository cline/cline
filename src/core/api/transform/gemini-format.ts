import { Anthropic } from "@anthropic-ai/sdk"
import { Content, GenerateContentResponse, Part } from "@google/genai"
import { ClineStorageMessage } from "@/shared/messages/content"

export function convertAnthropicContentToGemini(content: string | ClineStorageMessage["content"]): Part[] {
	if (typeof content === "string") {
		return [{ text: content }]
	}
	return content
		.flatMap((block): Part | undefined => {
			switch (block.type) {
				case "text":
					return { text: block.text, thoughtSignature: block.signature }
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
				case "tool_use":
					return {
						functionCall: {
							name: block.name,
							args: block.input as Record<string, unknown>,
						},
						thoughtSignature: block.signature,
					}
				case "tool_result":
					return {
						functionResponse: {
							name: block.tool_use_id,
							response: {
								result: block.content,
							},
						},
					}
				case "thinking":
					return { text: block.thinking, thought: true, thoughtSignature: block.signature }
				default:
					return undefined
			}
		})
		.filter((part): part is Part => part !== undefined) // Filter out unsupported blocks
}

export function convertAnthropicMessageToGemini(message: Anthropic.Messages.MessageParam): Content {
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToGemini(message.content),
	}
}

/*
It looks like gemini likes to double escape certain characters when writing file contents: https://discuss.ai.google.dev/t/function-call-string-property-is-double-escaped/37867
*/
export function unescapeGeminiContent(content: string) {
	return content.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\r/g, "\r").replace(/\\t/g, "\t")
}

export function convertGeminiResponseToAnthropic(response: GenerateContentResponse): Anthropic.Messages.Message {
	const content: Anthropic.Messages.ContentBlock[] = []

	const text = response.text
	if (text) {
		content.push({ type: "text", text, citations: null })
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
			case "SAFETY":
			case "RECITATION":
			case "OTHER":
				stop_reason = "stop_sequence"
				break
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
