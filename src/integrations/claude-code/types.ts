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

type ContentBlockStartEvent = {
	type: "content_block_start"
	index: number
	content_block: {
		type: "text" | "thinking" | "redacted_thinking"
		text?: string
		thinking?: string
		data?: string
		signature?: string
	}
}

type ContentBlockDeltaEvent = {
	type: "content_block_delta"
	index: number
	delta: {
		type: "text_delta" | "thinking_delta" | "signature_delta"
		text?: string
		thinking?: string
		signature?: string
	}
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
