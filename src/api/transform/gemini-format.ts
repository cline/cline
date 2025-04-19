import { Anthropic } from "@anthropic-ai/sdk"
// Update imports: Use GenerateContentResponse, remove InlineDataPart/TextPart, assume Part is available
import { Content, GenerateContentResponse, Part } from "@google/genai"

export function convertAnthropicContentToGemini(content: string | Anthropic.ContentBlockParam[]): Part[] {
	if (typeof content === "string") {
		// Remove TextPart cast
		return [{ text: content }]
	}
	return content.flatMap((block): Part => {
		// Add explicit Part return type for lambda
		switch (block.type) {
			case "text":
				// Remove TextPart cast
				return { text: block.text }
			case "image":
				if (block.source.type !== "base64") {
					throw new Error("Unsupported image source type")
				}
				// Remove InlineDataPart cast, assume structure is correct for Part
				return {
					inlineData: {
						data: block.source.data,
						mimeType: block.source.media_type,
					},
				}
			default:
				// Ensure a Part is returned or error thrown
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

/*
It looks like gemini likes to double escape certain characters when writing file contents: https://discuss.ai.google.dev/t/function-call-string-property-is-double-escaped/37867
*/
export function unescapeGeminiContent(content: string) {
	return content.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\r/g, "\r").replace(/\\t/g, "\t")
}

// Update response type to GenerateContentResponse
export function convertGeminiResponseToAnthropic(response: GenerateContentResponse): Anthropic.Messages.Message {
	const content: Anthropic.Messages.ContentBlock[] = []

	// Add the main text response - check if response.text exists
	// Assuming response.text is the correct accessor based on previous findings
	const text = response.text
	if (text) {
		content.push({ type: "text", text, citations: null })
	}

	// Determine stop reason
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
			// Add more cases if needed
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
