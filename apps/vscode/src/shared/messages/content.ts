import type { BedrockCoderMessageMetricsInfo, BedrockCoderMessageModelInfo } from "./metrics"

export type BedrockCoderPromptInputContent = string

export type BedrockCoderMessageRole = "user" | "assistant"

export interface BedrockCoderReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

interface BedrockCoderSharedMessageParam {
	// The id of the response that the block belongs to
	call_id?: string
}

export interface BedrockCoderTextContentBlock extends BedrockCoderSharedMessageParam {
	type: "text"
	text: string
	[key: string]: unknown
}

export interface BedrockCoderImageContentBlock extends BedrockCoderSharedMessageParam {
	type: "image"
	source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string }
	[key: string]: unknown
}

export interface BedrockCoderDocumentContentBlock extends BedrockCoderSharedMessageParam {
	type: "document"
	source: unknown
	[key: string]: unknown
}

export interface BedrockCoderUserToolResultContentBlock extends BedrockCoderSharedMessageParam {
	type: "tool_result"
	tool_use_id: string
	content?: string | Array<BedrockCoderTextContentBlock | BedrockCoderImageContentBlock>
	is_error?: boolean
	[key: string]: unknown
}

export interface BedrockCoderAssistantToolUseBlock extends BedrockCoderSharedMessageParam {
	type: "tool_use"
	id: string
	name: string
	input: unknown
	reasoning_details?: unknown[] | BedrockCoderReasoningDetailParam[]
	signature?: string
	[key: string]: unknown
}

export interface BedrockCoderAssistantThinkingBlock extends BedrockCoderSharedMessageParam {
	type: "thinking"
	thinking: string
	signature: string
	summary?: unknown[] | BedrockCoderReasoningDetailParam[]
	[key: string]: unknown
}

export interface BedrockCoderAssistantRedactedThinkingBlock extends BedrockCoderSharedMessageParam {
	type: "redacted_thinking"
	data: string
	[key: string]: unknown
}

export const REASONING_DETAILS_PROVIDERS = ["bedrockCoder", "openrouter"]

export type BedrockCoderToolResponseContent =
	| BedrockCoderPromptInputContent
	| Array<BedrockCoderTextContentBlock | BedrockCoderImageContentBlock>

export type BedrockCoderUserContent =
	| BedrockCoderTextContentBlock
	| BedrockCoderImageContentBlock
	| BedrockCoderDocumentContentBlock
	| BedrockCoderUserToolResultContentBlock

export type BedrockCoderAssistantContent =
	| BedrockCoderTextContentBlock
	| BedrockCoderImageContentBlock
	| BedrockCoderDocumentContentBlock
	| BedrockCoderAssistantToolUseBlock
	| BedrockCoderAssistantThinkingBlock
	| BedrockCoderAssistantRedactedThinkingBlock

export type BedrockCoderContent = BedrockCoderUserContent | BedrockCoderAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes BedrockCoder-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to BedrockCoder to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
export interface BedrockCoderStorageMessage {
	/**
	 * Response ID associated with this message
	 */
	id?: string
	role: BedrockCoderMessageRole
	content: BedrockCoderPromptInputContent | BedrockCoderContent[]
	/**
	 * NOTE: model information used when generating this message.
	 * Internal use for message conversion only.
	 * MUST be removed before sending message to any LLM provider.
	 */
	modelInfo?: BedrockCoderMessageModelInfo
	/**
	 * LLM operational and performance metrics for this message
	 * Includes token counts, costs.
	 */
	metrics?: BedrockCoderMessageMetricsInfo
	/**
	 * Timestamp of when the message was created
	 */
	ts?: number
}

/**
 * Converts BedrockCoderStorageMessage to Anthropic.MessageParam by removing BedrockCoder-specific fields
 * BedrockCoder-specific fields (like modelInfo, reasoning_details) are properly omitted.
 */
export function convertBedrockCoderStorageToAnthropicMessage(
	bedrockCoderMessage: BedrockCoderStorageMessage,
	provider = "anthropic",
): BedrockCoderStorageMessage {
	const { role, content } = bedrockCoderMessage

	// Handle string content - fast path
	if (typeof content === "string") {
		return { role, content }
	}

	// Removes thinking block that has no signature (invalid thinking block that's incompatible with Anthropic API)
	const filteredContent = content.filter((b) => b.type !== "thinking" || !!b.signature)

	// Handle array content - strip BedrockCoder-specific fields for non-reasoning_details providers
	const shouldCleanContent = !REASONING_DETAILS_PROVIDERS.includes(provider)
	const cleanedContent = shouldCleanContent ? filteredContent.map(cleanContentBlock) : filteredContent

	return { role, content: cleanedContent }
}

/**
 * BedrockCoder stores images as base64, so an image block's source is always a base64 source.
 * The Anthropic SDK types the source as a Base64ImageSource | URLImageSource union, so this
 * narrows to the base64 variant for the transform layer. URL sources are not produced by BedrockCoder,
 * so they degrade to empty values rather than throwing.
 */
export function getBase64ImageSource(source: BedrockCoderImageContentBlock["source"]): { mediaType: string; data: string } {
	if (source.type === "base64") {
		return { mediaType: source.media_type, data: source.data }
	}
	return { mediaType: "", data: "" }
}

/**
 * Builds a base64 data URL from an image block's source. See getBase64ImageSource.
 */
export function getImageDataUrl(source: BedrockCoderImageContentBlock["source"]): string {
	const { mediaType, data } = getBase64ImageSource(source)
	return `data:${mediaType};base64,${data}`
}

/**
 * Clean a content block by removing BedrockCoder-specific fields and returning only Anthropic-compatible fields
 */
export function cleanContentBlock(block: BedrockCoderContent): BedrockCoderContent {
	// Fast path: if no BedrockCoder-specific fields exist, return as-is
	const hasBedrockCoderFields =
		"reasoning_details" in block ||
		"call_id" in block ||
		"summary" in block ||
		(block.type !== "thinking" && "signature" in block)

	if (!hasBedrockCoderFields) {
		return block
	}

	// Removes BedrockCoder-specific fields & the signature field that's added for Gemini.
	const { reasoning_details, call_id, summary, ...rest } = block as any

	// Remove signature from non-thinking blocks that were added for Gemini
	if (block.type !== "thinking" && rest.signature) {
		rest.signature = undefined
	}

	return rest as BedrockCoderContent
}
