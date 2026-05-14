import { Anthropic } from "@anthropic-ai/sdk"
import { Content, GenerateContentResponse, Part } from "@google/genai"
import { ClineStorageMessage } from "@/shared/messages/content"

// Source: https://ai.google.dev/gemini-api/docs/thought-signatures#faqs
// While injecting custom function call blocks into the request is strongly discouraged,
// in cases where it can't be avoided, e.g. providing information to the model on function
// calls and responses that were executed deterministically by the client, or transferring a
// trace from a different model that does not include thought signatures, you can set the following dummy signatures of either
// "context_engineering_is_the_way_to_go" or "skip_thought_signature_validator" in the thought signature field to skip validation.
const GEMINI_DUMMY_THOUGHT_SIGNATURE = "skip_thought_signature_validator"

type GeminiToolNameById = Map<string, string>

function rememberGeminiToolUse(toolNameById: GeminiToolNameById | undefined, block: Anthropic.ToolUseBlockParam) {
	if (!toolNameById) {
		return
	}

	if (block.id) {
		toolNameById.set(block.id, block.name)
	}

	const callId = (block as { call_id?: string }).call_id
	if (callId) {
		toolNameById.set(callId, block.name)
	}
}

function getGeminiFunctionResponseName(block: Anthropic.ToolResultBlockParam, toolNameById: GeminiToolNameById | undefined) {
	const callId = (block as { call_id?: string }).call_id
	return toolNameById?.get(block.tool_use_id) ?? (callId ? toolNameById?.get(callId) : undefined) ?? block.tool_use_id
}

export function convertAnthropicContentToGemini(
	content: string | ClineStorageMessage["content"],
	toolNameById?: GeminiToolNameById,
): Part[] {
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
					rememberGeminiToolUse(toolNameById, block)
					return {
						functionCall: {
							id: block.id,
							name: block.name,
							args: block.input as Record<string, unknown>,
						},
						// Thought signature is required, so provide a dummy one if not present
						thoughtSignature: block.signature || GEMINI_DUMMY_THOUGHT_SIGNATURE,
					}
				case "tool_result":
					const name = getGeminiFunctionResponseName(block, toolNameById)
					if (!name) {
						throw new Error("Cannot convert Gemini tool result without a matching function name")
					}
					return {
						functionResponse: {
							id: block.tool_use_id,
							name,
							response: {
								result: block.content,
							},
						},
					}
				case "thinking":
					return {
						text: block.thinking,
						thought: true,
						thoughtSignature: block.signature || GEMINI_DUMMY_THOUGHT_SIGNATURE,
					}
				default:
					return undefined
			}
		})
		.filter((part): part is Part => part !== undefined) // Filter out unsupported blocks
}

export function convertAnthropicMessageToGemini(
	message: Anthropic.Messages.MessageParam,
	toolNameById?: GeminiToolNameById,
): Content {
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts: convertAnthropicContentToGemini(message.content, toolNameById),
	}
}

export function convertAnthropicMessagesToGemini(messages: Anthropic.Messages.MessageParam[]): Content[] {
	const toolNameById: GeminiToolNameById = new Map()
	return messages.map((message) => convertAnthropicMessageToGemini(message, toolNameById))
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
