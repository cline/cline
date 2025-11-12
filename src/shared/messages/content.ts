import { Anthropic } from "@anthropic-ai/sdk"

type ClinePromptInputContent = string

type ClineMessageRole = "user" | "assistant"

export interface ClineMessageModelInfo {
	modelId: string
	providerId: string
}

export interface ClineReasoningDetailParam {
	type: "reasoning.text" | string
	text: string
	signature: string
	format: "anthropic-claude-v1" | string
	index: number
}

/**
 * An extension of Anthropic.MessageParam that includes Cline-specific fields: reasoning_details.
 * This ensures backward compatibility where the messages were stored in Anthropic format with addtional
 * fields unknown to Anthropic SDK.
 */
export interface ClineTextContentBlock extends Anthropic.Messages.TextBlockParam {
	// reasoning_details only exists for cline/openrouter providers
	reasoning_details?: ClineReasoningDetailParam[]
}

export interface ClineImageContentBlock extends Anthropic.ImageBlockParam {}

export interface ClineDocumentContentBlock extends Anthropic.DocumentBlockParam {}

export interface ClineUserToolResultContentBlock extends Anthropic.ToolResultBlockParam {}

// Assistant only content types
export interface ClineAssistantToolUseBlock extends Anthropic.ToolUseBlockParam {}

export interface ClineAssistantThinkingBlock extends Anthropic.Messages.ThinkingBlock {}

export interface ClineAssistantRedactedThinkingBlock extends Anthropic.Messages.RedactedThinkingBlockParam {}

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
export interface ClineStorageMessage extends Anthropic.MessageParam {
	role: ClineMessageRole
	content: ClinePromptInputContent | ClineContent[]
	modelInfo?: ClineMessageModelInfo
}
