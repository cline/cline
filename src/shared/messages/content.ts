import { Anthropic } from "@anthropic-ai/sdk"
import { BeadsmithMessageMetricsInfo, BeadsmithMessageModelInfo } from "./metrics"

export type BeadsmithPromptInputContent = string

export type BeadsmithMessageRole = "user" | "assistant"

export interface BeadsmithReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

interface BeadsmithSharedMessageParam {
	// The id of the response that the block belongs to
	call_id?: string
}

export const REASONING_DETAILS_PROVIDERS = ["cline", "openrouter"]

/**
 * An extension of Anthropic.MessageParam that includes Beadsmith-specific fields: reasoning_details.
 * This ensures backward compatibility where the messages were stored in Anthropic format with additional
 * fields unknown to Anthropic SDK.
 */
export interface BeadsmithTextContentBlock extends Anthropic.TextBlockParam, BeadsmithSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: BeadsmithReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface BeadsmithImageContentBlock extends Anthropic.ImageBlockParam, BeadsmithSharedMessageParam {}

export interface BeadsmithDocumentContentBlock extends Anthropic.DocumentBlockParam, BeadsmithSharedMessageParam {}

export interface BeadsmithUserToolResultContentBlock extends Anthropic.ToolResultBlockParam, BeadsmithSharedMessageParam {}

/**
 * Assistant only content types
 */
export interface BeadsmithAssistantToolUseBlock extends Anthropic.ToolUseBlockParam, BeadsmithSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: unknown[] | BeadsmithReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

export interface BeadsmithAssistantThinkingBlock extends Anthropic.ThinkingBlock, BeadsmithSharedMessageParam {
	// The summary items returned by OpenAI response API
	// The reasoning details that will be moved to the text block when finalized
	summary?: unknown[] | BeadsmithReasoningDetailParam[]
}

export interface BeadsmithAssistantRedactedThinkingBlock
	extends Anthropic.RedactedThinkingBlockParam,
		BeadsmithSharedMessageParam {}

export type BeadsmithToolResponseContent =
	| BeadsmithPromptInputContent
	| Array<BeadsmithTextContentBlock | BeadsmithImageContentBlock>

export type BeadsmithUserContent =
	| BeadsmithTextContentBlock
	| BeadsmithImageContentBlock
	| BeadsmithDocumentContentBlock
	| BeadsmithUserToolResultContentBlock

export type BeadsmithAssistantContent =
	| BeadsmithTextContentBlock
	| BeadsmithImageContentBlock
	| BeadsmithDocumentContentBlock
	| BeadsmithAssistantToolUseBlock
	| BeadsmithAssistantThinkingBlock
	| BeadsmithAssistantRedactedThinkingBlock

export type BeadsmithContent = BeadsmithUserContent | BeadsmithAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes Beadsmith-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to Beadsmith to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
export interface BeadsmithStorageMessage extends Anthropic.MessageParam {
	/**
	 * Response ID associated with this message
	 */
	id?: string
	role: BeadsmithMessageRole
	content: BeadsmithPromptInputContent | BeadsmithContent[]
	/**
	 * NOTE: model information used when generating this message.
	 * Internal use for message conversion only.
	 * MUST be removed before sending message to any LLM provider.
	 */
	modelInfo?: BeadsmithMessageModelInfo
	/**
	 * LLM operational and performance metrics for this message
	 * Includes token counts, costs.
	 */
	metrics?: BeadsmithMessageMetricsInfo
}

/**
 * Converts BeadsmithStorageMessage to Anthropic.MessageParam by removing Beadsmith-specific fields
 * Beadsmith-specific fields (like modelInfo, reasoning_details) are properly omitted.
 */
export function convertBeadsmithStorageToAnthropicMessage(
	beadsmithMessage: BeadsmithStorageMessage,
	provider = "anthropic",
): Anthropic.MessageParam {
	const { role, content } = beadsmithMessage

	// Handle string content - fast path
	if (typeof content === "string") {
		return { role, content }
	}

	// Removes thinking block that has no signature (invalid thinking block that's incompatible with Anthropic API)
	const filteredContent = content.filter((b) => b.type !== "thinking" || !!b.signature)

	// Handle array content - strip Beadsmith-specific fields for non-reasoning_details providers
	const shouldCleanContent = !REASONING_DETAILS_PROVIDERS.includes(provider)
	const cleanedContent = shouldCleanContent
		? filteredContent.map(cleanContentBlock)
		: (filteredContent as Anthropic.MessageParam["content"])

	return { role, content: cleanedContent }
}

/**
 * Clean a content block by removing Beadsmith-specific fields and returning only Anthropic-compatible fields
 */
export function cleanContentBlock(block: BeadsmithContent): Anthropic.ContentBlock {
	// Fast path: if no Beadsmith-specific fields exist, return as-is
	const hasBeadsmithFields =
		"reasoning_details" in block ||
		"call_id" in block ||
		"summary" in block ||
		(block.type !== "thinking" && "signature" in block)

	if (!hasBeadsmithFields) {
		return block as Anthropic.ContentBlock
	}

	// Removes Beadsmith-specific fields & the signature field that's added for Gemini.
	// biome-ignore lint/correctness/noUnusedVariables: intentional destructuring to remove properties
	const { reasoning_details, call_id, summary, ...rest } = block as any

	// Remove signature from non-thinking blocks that were added for Gemini
	if (block.type !== "thinking" && rest.signature) {
		rest.signature = undefined
	}

	return rest satisfies Anthropic.ContentBlock
}
