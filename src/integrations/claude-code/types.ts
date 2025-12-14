import type { Anthropic } from "@anthropic-ai/sdk"

type InitMessage = {
	type: "system"
	subtype: "init"
	session_id: string
	tools: string[]
	mcp_servers: string[]
	apiKeySource: "none" | "/login managed key" | string
}

type AssistantMessage = {
	type: "assistant"
	message: Anthropic.Messages.Message
	session_id: string
}

type ErrorMessage = {
	type: "error"
}

type ResultMessage = {
	type: "result"
	subtype: "success"
	total_cost_usd: number
	is_error: boolean
	duration_ms: number
	duration_api_ms: number
	num_turns: number
	result: string
	session_id: string
}

type StreamEventMessage = {
	type: "stream_event"
	event: StreamEvent
	session_id: string
	parent_tool_use_id: string | null
	uuid: string
}

type StreamEvent =
	| MessageStartEvent
	| ContentBlockStartEvent
	| ContentBlockDeltaEvent
	| ContentBlockStopEvent
	| MessageDeltaEvent
	| MessageStopEvent

type MessageStartEvent = {
	type: "message_start"
	message: {
		model: string
		id: string
		type: "message"
		role: "assistant"
		content: []
		stop_reason: null
		stop_sequence: null
		usage: {
			input_tokens: number
			cache_creation_input_tokens?: number
			cache_read_input_tokens?: number
			cache_creation?: {
				ephemeral_5m_input_tokens?: number
				ephemeral_1h_input_tokens?: number
			}
			output_tokens: number
			service_tier?: string
		}
	}
}

/**
 * ContentBlockStartEvent contains one of three different content block types:
 * - "text": Regular text content (uses `text` property)
 * - "thinking": Extended thinking content (uses `thinking` and optional `signature` properties)
 * - "redacted_thinking": Redacted thinking content (uses `data` and `signature` properties)
 *
 * Note: `tool_use` blocks are NOT included in stream events - they only appear in the final
 * `assistant` chunk message. This is why tool calls must be extracted from the assistant
 * chunk even when streaming is enabled.
 */
type ContentBlockStartEvent = {
	type: "content_block_start"
	index: number
	content_block: TextContentBlock | ThinkingContentBlock | RedactedThinkingContentBlock
}

type TextContentBlock = {
	type: "text"
	text?: string
}

type ThinkingContentBlock = {
	type: "thinking"
	thinking?: string
	signature?: string
}

type RedactedThinkingContentBlock = {
	type: "redacted_thinking"
	data?: string
	signature?: string
}

type TextDelta = {
	type: "text_delta"
	text?: string
}

type ThinkingDelta = {
	type: "thinking_delta"
	thinking?: string
}

type SignatureDelta = {
	type: "signature_delta"
	signature?: string
}

type ContentBlockDeltaEvent = {
	type: "content_block_delta"
	index: number
	delta: TextDelta | ThinkingDelta | SignatureDelta
}

type ContentBlockStopEvent = {
	type: "content_block_stop"
	index: number
}

type MessageDeltaEvent = {
	type: "message_delta"
	delta: {
		stop_reason: string | null
		stop_sequence: string | null
	}
	usage: {
		output_tokens: number
	}
}

type MessageStopEvent = {
	type: "message_stop"
}

export type ClaudeCodeMessage = InitMessage | AssistantMessage | ErrorMessage | ResultMessage | StreamEventMessage
