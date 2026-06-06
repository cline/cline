import { Anthropic } from "@anthropic-ai/sdk"
import { ClineMessageMetricsInfo, ClineMessageModelInfo } from "./metrics"

type ClinePromptInputContent = string

type ClineMessageRole = "user" | "assistant"

interface ClineReasoningDetailParam {
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

/**
 * An extension of Anthropic.MessageParam that includes Cline-specific fields: reasoning_details.
 * This ensures backward compatibility where the messages were stored in Anthropic format with additional
 * fields unknown to Anthropic SDK.
 */
interface ClineTextContentBlock extends Anthropic.TextBlockParam, ClineSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: ClineReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

interface ClineImageContentBlock extends Anthropic.ImageBlockParam, ClineSharedMessageParam {}

interface ClineDocumentContentBlock extends Anthropic.DocumentBlockParam, ClineSharedMessageParam {}

interface ClineUserToolResultContentBlock extends Anthropic.ToolResultBlockParam, ClineSharedMessageParam {}

/**
 * Assistant only content types
 */
interface ClineAssistantToolUseBlock extends Anthropic.ToolUseBlockParam, ClineSharedMessageParam {
	// reasoning_details only exists for providers listed in REASONING_DETAILS_PROVIDERS
	reasoning_details?: unknown[] | ClineReasoningDetailParam[]
	// Thought Signature associates with Gemini
	signature?: string
}

interface ClineAssistantThinkingBlock extends Anthropic.ThinkingBlock, ClineSharedMessageParam {
	// The summary items returned by OpenAI response API
	// The reasoning details that will be moved to the text block when finalized
	summary?: unknown[] | ClineReasoningDetailParam[]
}

interface ClineAssistantRedactedThinkingBlock extends Anthropic.RedactedThinkingBlockParam, ClineSharedMessageParam {}

export type ClineToolResponseContent = ClinePromptInputContent | Array<ClineTextContentBlock | ClineImageContentBlock>

type ClineUserContent =
	| ClineTextContentBlock
	| ClineImageContentBlock
	| ClineDocumentContentBlock
	| ClineUserToolResultContentBlock

type ClineAssistantContent =
	| ClineTextContentBlock
	| ClineImageContentBlock
	| ClineDocumentContentBlock
	| ClineAssistantToolUseBlock
	| ClineAssistantThinkingBlock
	| ClineAssistantRedactedThinkingBlock

type ClineContent = ClineUserContent | ClineAssistantContent

/**
 * An extension of Anthropic.MessageParam that includes Cline-specific fields.
 * This ensures backward compatibility where the messages were stored in Anthropic format,
 * while allowing for additional metadata specific to Cline to avoid unknown fields in Anthropic SDK
 * added by ignoring the type checking for those fields.
 */
interface ClineStorageMessage extends Anthropic.MessageParam {
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
