/**
 * Conversion utilities for transforming between Anthropic and Google Gemini API formats.
 * This module contains adapter functions that enable compatibility between the two API formats,
 * allowing a system designed for Anthropic's Claude to work with Google's Gemini models.
 */
import { Anthropic } from "@anthropic-ai/sdk"
import { Content, EnhancedGenerateContentResponse, InlineDataPart, Part, TextPart } from "@google/generative-ai"

/**
 * Converts Anthropic content format to Gemini's Part format.
 *
 * @param content - Either a string or an array of Anthropic content blocks
 * @returns An array of Gemini-compatible Part objects
 * @throws Error when encountering unsupported content types or image source types
 */
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
					throw new Error("Unsupported image source type: Gemini only supports base64 encoded images")
				}
				return {
					inlineData: {
						data: block.source.data,
						mimeType: block.source.media_type,
					},
				} as InlineDataPart
			default:
				throw new Error(
					`Unsupported content block type: ${(block as any).type}. Only text and image types are currently supported.`,
				)
		}
	})
}

/**
 * Converts an Anthropic message to Gemini's Content format.
 * Handles the role mapping difference between Anthropic ("assistant") and Gemini ("model").
 *
 * @param message - An Anthropic message object
 * @returns A Gemini-compatible Content object
 */
export function convertAnthropicMessageToGemini(message: Anthropic.Messages.MessageParam): Content {
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToGemini(message.content),
	}
}

/**
 * Fixes Gemini's double-escaping of special characters in string responses.
 * Gemini sometimes returns strings with double-escaped characters (e.g., \\n instead of \n)
 * when writing file contents or other structured data.
 *
 * @see https://discuss.ai.google.dev/t/function-call-string-property-is-double-escaped/37867
 * @param content - Potentially double-escaped string from Gemini
 * @returns Properly unescaped string with normalized special characters
 */
export function unescapeGeminiContent(content: string) {
	return content.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\r/g, "\r").replace(/\\t/g, "\t")
}

/**
 * Converts a Gemini response to Anthropic's message format.
 * Maps finish reasons between different API terminologies and structures the response
 * to match Anthropic's expected format.
 *
 * @param response - The Gemini response object
 * @returns An Anthropic-compatible message object
 */
export function convertGeminiResponseToAnthropic(response: EnhancedGenerateContentResponse): Anthropic.Messages.Message {
	const content: Anthropic.Messages.ContentBlock[] = []

	// Add the main text response
	const text = response.text()
	if (text) {
		content.push({ type: "text", text, citations: null })
	}

	// Determine stop reason by mapping Gemini's finishReason to Anthropic's stop_reason
	let stop_reason: Anthropic.Messages.Message["stop_reason"] = null
	const finishReason = response.candidates?.[0]?.finishReason
	if (finishReason) {
		switch (finishReason) {
			case "STOP":
				// Normal completion in Gemini corresponds to end_turn in Anthropic
				stop_reason = "end_turn"
				break
			case "MAX_TOKENS":
				// Both APIs use similar terminology for max token limit reached
				stop_reason = "max_tokens"
				break
			case "SAFETY":
			case "RECITATION":
			case "OTHER":
				// These Gemini reasons map to Anthropic's stop_sequence
				stop_reason = "stop_sequence"
				break
			// Add more cases if needed
		}
	}

	return {
		id: `msg_${Date.now()}`, // Generate a unique ID based on timestamp (consider using UUID in production)
		type: "message",
		role: "assistant",
		content,
		model: "", // Gemini doesn't provide the model name in the response
		stop_reason,
		stop_sequence: null, // Gemini doesn't provide this information
		usage: {
			input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
			output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
			cache_creation_input_tokens: null, // Anthropic-specific, not available in Gemini
			cache_read_input_tokens: null, // Anthropic-specific, not available in Gemini
		},
	}
}
