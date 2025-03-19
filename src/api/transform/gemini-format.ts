/**
 * Conversion utilities for transforming between Anthropic and Google Gemini API formats.
 * This module contains adapter functions that enable compatibility between the two API formats,
 * allowing a system designed for Anthropic's Claude to work with Google's Gemini models.
 *
 * @example
 * // Basic usage of conversion utilities:
 * import { Anthropic } from "@anthropic-ai/sdk";
 * import { convertAnthropicMessageToGemini, unescapeGeminiContent } from "../api/transform/gemini-format";
 *
 * // Convert Anthropic message to Gemini format
 * const anthropicMessage: Anthropic.Messages.MessageParam = {
 *   role: "user",
 *   content: "Hello, how are you?"
 * };
 * const geminiContent = convertAnthropicMessageToGemini(anthropicMessage);
 *
 * // Handle escaped content from Gemini response
 * const escapedContent = "Hello,\\nHow are you?";
 * const unescaped = unescapeGeminiContent(escapedContent);
 * console.log(unescaped); // "Hello,\nHow are you?"
 */
import { Anthropic } from "@anthropic-ai/sdk"
import { Content, EnhancedGenerateContentResponse, InlineDataPart, Part, TextPart } from "@google/generative-ai"

/**
 * Converts Anthropic content format to Gemini's Part format.
 *
 * @param content - Either a string or an array of Anthropic content blocks
 * @returns An array of Gemini-compatible Part objects
 * @throws Error when encountering unsupported content types or image source types
 *
 * @example
 * // Convert a simple string
 * const parts = convertAnthropicContentToGemini("Hello, world!");
 * // Result: [{ text: "Hello, world!" }]
 *
 * @example
 * // Convert an array of content blocks with text and image
 * const content: Anthropic.ContentBlockParam[] = [
 *   { type: "text", text: "What's in this image?" },
 *   {
 *     type: "image",
 *     source: {
 *       type: "base64",
 *       media_type: "image/jpeg",
 *       data: "base64EncodedImageData"
 *     }
 *   }
 * ];
 * const parts = convertAnthropicContentToGemini(content);
 * // Result: [
 * //   { text: "What's in this image?" },
 * //   { inlineData: { data: "base64EncodedImageData", mimeType: "image/jpeg" } }
 * // ]
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
 *
 * @example
 * // Convert a user message
 * const userMessage: Anthropic.Messages.MessageParam = {
 *   role: "user",
 *   content: "Hello, how are you?"
 * };
 * const geminiContent = convertAnthropicMessageToGemini(userMessage);
 * // Result: { role: "user", parts: [{ text: "Hello, how are you?" }] }
 *
 * @example
 * // Convert an assistant message
 * const assistantMessage: Anthropic.Messages.MessageParam = {
 *   role: "assistant",
 *   content: "I'm doing well, thank you!"
 * };
 * const geminiContent = convertAnthropicMessageToGemini(assistantMessage);
 * // Result: { role: "model", parts: [{ text: "I'm doing well, thank you!" }] }
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
 *
 * @example
 * // Unescape newlines and quotes
 * const escaped = "Line 1\\nLine 2\\nHe said, \\\"Hello!\\\"";
 * const unescaped = unescapeGeminiContent(escaped);
 * console.log(unescaped); // "Line 1\nLine 2\nHe said, \"Hello!\""
 *
 * @example
 * // Handle Windows paths
 * const escaped = "Path: C:\\\\Program Files\\\\App";
 * const unescaped = unescapeGeminiContent(escaped);
 * console.log(unescaped); // "Path: C:\Program Files\App"
 */
export function unescapeGeminiContent(content: string) {
	// Process escape sequences in a specific order to avoid conflicts
	// First handle standard escaped characters
	let unescaped = content
		.replace(/\\n/g, "\n")
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")

	// Special handling for Windows paths with backslashes
	// This regex looks for patterns like C:\\Program Files\\App
	// and replaces them with single backslashes (C:\Program Files\App)
	unescaped = unescaped.replace(/([A-Z]):\\\\([^\\].*?)(?=\\\\|$)/gi, (match, drive, path) => {
		return `${drive}:\\${path.replace(/\\\\/g, "\\")}`
	})

	// Handle any remaining double backslashes that might be intentional escapes
	// in contexts other than Windows paths
	unescaped = unescaped.replace(/\\\\(?=[^\\/])/g, "\\")

	return unescaped
}

/**
 * Converts a Gemini response to Anthropic's message format.
 * Maps finish reasons between different API terminologies and structures the response
 * to match Anthropic's expected format.
 *
 * @param response - The Gemini response object
 * @returns An Anthropic-compatible message object
 *
 * @example
 * // Convert a Gemini response to Anthropic format
 * const geminiResponse = await model.generateContent(...);
 * const anthropicMessage = convertGeminiResponseToAnthropic(geminiResponse);
 * console.log(anthropicMessage.content); // Array of content blocks
 * console.log(anthropicMessage.stop_reason); // Mapped stop reason
 * console.log(anthropicMessage.usage); // Token usage information
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
