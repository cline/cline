import OpenAI from "openai"
import {
	ClineAssistantThinkingBlock,
	ClineAssistantToolUseBlock,
	ClineImageContentBlock,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineUserToolResultContentBlock,
} from "@/shared/messages/content"

/**
 * DeepSeek V4/V3 model message format with reasoning_content support.
 *
 * Per DeepSeek thinking_mode API documentation:
 * - reasoning_content is a standalone field at the assistant message level
 * - In turns with tool calls: reasoning_content MUST be passed back in all subsequent requests
 * - In turns without tool calls: reasoning_content is optional and will be ignored
 */
export type DeepSeekModelMessage = OpenAI.Chat.ChatCompletionMessageParam & {
	reasoning_content: string
}

/**
 * Converts ClineStorageMessage[] (Anthropic format) to OpenAI Chat Completions format
 * with reasoning_content attached for DeepSeek V4/V3 models.
 *
 * Strategy based on DeepSeek V4 thinking_mode documentation:
 * 1. Pure thinking messages (no text, no tool_use) are skipped — their thinking text
 *    is accumulated and attached to the next valid assistant message.
 * 2. Valid assistant messages (with text or tool_use) always carry reasoning_content
 *    when they have thinking blocks or pending thinking.
 * 3. Empty reasoning_content (thinking: "") is preserved.
 *
 * @param originalMessages - ClineStorageMessage[] in Anthropic format
 * @param systemPrompt - System prompt to prepend as role: "system"
 * @returns DeepSeekModelMessage[] ready to send to DeepSeek API
 */
export function convertDeepSeekMessages(originalMessages: ClineStorageMessage[], systemPrompt: string): DeepSeekModelMessage[] {
	const result: DeepSeekModelMessage[] = [{ role: "system", content: systemPrompt } as DeepSeekModelMessage]
	let pendingThinking = ""

	for (const msg of originalMessages) {
		if (msg.role === "assistant") {
			const { thinkingText, hasText, hasToolUse } = extractAssistantBlocks(msg)
			const converted = buildAssistantMessage(msg, hasText, hasToolUse)

			if (converted) {
				// Build reasoning_content: pending + current thinking
				let reasoning = ""
				if (pendingThinking) {
					reasoning = pendingThinking
					pendingThinking = ""
				}
				if (thinkingText) {
					reasoning = reasoning ? `${reasoning}\n${thinkingText}` : thinkingText
				}
				if (reasoning) {
					converted.reasoning_content = reasoning
				}
				result.push(converted)
			} else {
				// Pure thinking message — accumulate for next valid assistant
				if (thinkingText) {
					pendingThinking = pendingThinking ? `${pendingThinking}\n${thinkingText}` : thinkingText
				}
			}
		} else if (msg.role === "user") {
			result.push(...convertUser(msg))
			// New turn clears pending thinking buffer
			pendingThinking = ""
		}
	}

	return result
}

// ---- Internal converters ----

/**
 * Extracts thinking text and checks for text/tool_use blocks in an assistant message.
 */
function extractAssistantBlocks(msg: ClineStorageMessage): {
	thinkingText: string
	hasText: boolean
	hasToolUse: boolean
} {
	let thinkingText = ""
	let hasText = false
	let hasToolUse = false

	if (Array.isArray(msg.content)) {
		for (const part of msg.content) {
			if (part.type === "thinking") {
				thinkingText += (part as ClineAssistantThinkingBlock).thinking
			} else if (part.type === "text") {
				hasText = true
			} else if (part.type === "tool_use") {
				hasToolUse = true
			}
		}
	}

	return { thinkingText, hasText, hasToolUse }
}

/**
 * Builds an OpenAI assistant message from text and tool_use blocks.
 * Returns null if the message has neither text nor tool_use (pure thinking).
 */
function buildAssistantMessage(msg: ClineStorageMessage, hasText: boolean, hasToolUse: boolean): DeepSeekModelMessage | null {
	if (!hasText && !hasToolUse) {
		return null
	}

	if (!Array.isArray(msg.content)) {
		return { role: "assistant", content: msg.content || null } as DeepSeekModelMessage
	}

	const textParts: string[] = []
	const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []

	for (const part of msg.content) {
		if (part.type === "text") {
			textParts.push((part as ClineTextContentBlock).text)
		} else if (part.type === "tool_use") {
			const toolUse = part as ClineAssistantToolUseBlock
			toolCalls.push({
				id: toolUse.id,
				type: "function",
				function: {
					name: toolUse.name,
					arguments: JSON.stringify(toolUse.input),
				},
			})
		}
		// thinking and redacted_thinking are ignored here
	}

	return {
		role: "assistant",
		content: hasText ? textParts.join("\n") : null,
		tool_calls: hasToolUse ? toolCalls : undefined,
		reasoning_content: "",
	}
}

function convertUser(msg: ClineStorageMessage): DeepSeekModelMessage[] {
	const result: DeepSeekModelMessage[] = []

	if (!Array.isArray(msg.content)) {
		result.push({ role: "user", content: msg.content } as DeepSeekModelMessage)
		return result
	}

	const toolResultBlocks: ClineUserToolResultContentBlock[] = []
	const textParts: string[] = []
	const imageBlocks: ClineImageContentBlock[] = []

	for (const part of msg.content) {
		if (part.type === "tool_result") {
			toolResultBlocks.push(part as ClineUserToolResultContentBlock)
		} else if (part.type === "text") {
			textParts.push((part as ClineTextContentBlock).text)
		} else if (part.type === "image") {
			imageBlocks.push(part as ClineImageContentBlock)
		}
	}

	// Tool results → role: "tool"
	for (const tr of toolResultBlocks) {
		let content: string
		if (typeof tr.content === "string") {
			content = tr.content
		} else if (Array.isArray(tr.content)) {
			// Extract text, note images
			const imageNoteParts: string[] = []
			for (const p of tr.content) {
				if (p.type === "text") {
					imageNoteParts.push(p.text)
				} else if (p.type === "image") {
					imageNoteParts.push("(see following user message for image)")
				}
			}
			content = imageNoteParts.join("\n")
		} else {
			content = ""
		}
		result.push({
			role: "tool",
			tool_call_id: tr.tool_use_id,
			content,
		} as DeepSeekModelMessage)
	}

	// Non-tool content → role: "user"
	if (textParts.length > 0 || imageBlocks.length > 0) {
		if (imageBlocks.length === 0) {
			result.push({
				role: "user",
				content: textParts.join("\n"),
			} as DeepSeekModelMessage)
		} else {
			const parts: OpenAI.Chat.ChatCompletionContentPart[] = textParts.map((t) => ({
				type: "text" as const,
				text: t,
			}))
			for (const img of imageBlocks) {
				parts.push({
					type: "image_url",
					image_url: {
						url: `data:${img.source.media_type};base64,${img.source.data}`,
					},
				})
			}
			result.push({ role: "user", content: parts } as DeepSeekModelMessage)
		}
	}

	return result
}
