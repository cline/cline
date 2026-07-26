import type { ClineMessageMetricsInfo, ClineMessageModelInfo } from "./metrics"

export type ClinePromptInputContent = string

export type ClineMessageRole = "user" | "assistant"

export interface ClineReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

interface ClineSharedMessageParam {
	// The id of the response that the block belongs to
	call_id?: string
}

export interface ClineTextContentBlock extends ClineSharedMessageParam {
	type: "text"
	text: string
	[key: string]: unknown
}

export interface ClineImageContentBlock extends ClineSharedMessageParam {
	type: "image"
	source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string }
	[key: string]: unknown
}

export interface ClineDocumentContentBlock extends ClineSharedMessageParam {
	type: "document"
	source: unknown
	[key: string]: unknown
}

export interface ClineUserToolResultContentBlock extends ClineSharedMessageParam {
	type: "tool_result"
	tool_use_id: string
	content?: string | Array<ClineTextContentBlock | ClineImageContentBlock>
	is_error?: boolean
	[key: string]: unknown
}

export interface ClineAssistantToolUseBlock extends ClineSharedMessageParam {
	type: "tool_use"
	id: string
	name: string
	input: unknown
	reasoning_details?: unknown[] | ClineReasoningDetailParam[]
	signature?: string
	[key: string]: unknown
}

export interface ClineAssistantThinkingBlock extends ClineSharedMessageParam {
	type: "thinking"
	thinking: string
	signature: string
	summary?: unknown[] | ClineReasoningDetailParam[]
	[key: string]: unknown
}

export interface ClineAssistantRedactedThinkingBlock extends ClineSharedMessageParam {
	type: "redacted_thinking"
	data: string
	[key: string]: unknown
}

export const REASONING_DETAILS_PROVIDERS = ["cline", "openrouter"]

export type ClineToolResponseContent = ClinePromptInputContent | Array<ClineTextContentBlock | ClineImageContentBlock>

export type ClineUserContent =
	| ClineTextContentBlock
	| ClineImageContentBlock
	| ClineDocumentContentBlock
	| ClineUserToolResultContentBlock

export type ClineAssistantContent =
	| ClineTextContentBlock
	| ClineImageContentBlock
	| ClineDocumentContentBlock
	| ClineAssistantToolUseBlock
	| ClineAssistantThinkingBlock
	| ClineAssistantRedactedThinkingBlock

export type ClineContent = ClineUserContent | ClineAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes Cline-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to Cline to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
export interface ClineStorageMessage {
	/**
	 * Response ID associated with this message
	 */
	id?: string
	role: ClineMessageRole
	content: ClinePromptInputContent | ClineContent[]
	/**
	 * NOTE: model information used when generating this message.
	 * Internal use for message conversion only.
	 * MUST be removed before sending message to any LLM provider.
	 */
	modelInfo?: ClineMessageModelInfo
	/**
	 * LLM operational and performance metrics for this message
	 * Includes token counts, costs.
	 */
	metrics?: ClineMessageMetricsInfo
	/**
	 * Timestamp of when the message was created
	 */
	ts?: number
}

/**
 * Converts ClineStorageMessage to Anthropic.MessageParam by removing Cline-specific fields
 * Cline-specific fields (like modelInfo, reasoning_details) are properly omitted.
 */
export function convertClineStorageToAnthropicMessage(
	clineMessage: ClineStorageMessage,
	provider = "anthropic",
): ClineStorageMessage {
	const { role, content } = clineMessage

	// Handle string content - fast path
	if (typeof content === "string") {
		return { role, content }
	}

	// Removes thinking block that has no signature (invalid thinking block that's incompatible with Anthropic API)
	const filteredContent = content.filter((b) => b.type !== "thinking" || !!b.signature)

	// Handle array content - strip Cline-specific fields for non-reasoning_details providers
	const shouldCleanContent = !REASONING_DETAILS_PROVIDERS.includes(provider)
	const cleanedContent = shouldCleanContent ? filteredContent.map(cleanContentBlock) : filteredContent

	return { role, content: cleanedContent }
}

/**
 * Cline stores images as base64, so an image block's source is always a base64 source.
 * The Anthropic SDK types the source as a Base64ImageSource | URLImageSource union, so this
 * narrows to the base64 variant for the transform layer. URL sources are not produced by Cline,
 * so they degrade to empty values rather than throwing.
 */
export function getBase64ImageSource(source: ClineImageContentBlock["source"]): { mediaType: string; data: string } {
	if (source.type === "base64") {
		return { mediaType: source.media_type, data: source.data }
	}
	return { mediaType: "", data: "" }
}

/**
 * Builds a base64 data URL from an image block's source. See getBase64ImageSource.
 */
export function getImageDataUrl(source: ClineImageContentBlock["source"]): string {
	const { mediaType, data } = getBase64ImageSource(source)
	return `data:${mediaType};base64,${data}`
}

/**
 * Clean a content block by removing Cline-specific fields and returning only Anthropic-compatible fields
 */
export function cleanContentBlock(block: ClineContent): ClineContent {
	// Fast path: if no Cline-specific fields exist, return as-is
	const hasClineFields =
		"reasoning_details" in block ||
		"call_id" in block ||
		"summary" in block ||
		(block.type !== "thinking" && "signature" in block)

	if (!hasClineFields) {
		return block
	}

	// Removes Cline-specific fields & the signature field that's added for Gemini.
	const { reasoning_details, call_id, summary, ...rest } = block as any

	// Remove signature from non-thinking blocks that were added for Gemini
	if (block.type !== "thinking" && rest.signature) {
		rest.signature = undefined
	}

	return rest as ClineContent
}
