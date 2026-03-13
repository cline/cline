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
	message: Anthropic.Messages.Message & {
		// Newer Claude Code CLI versions may include an error field on the message
		error?: string
	}
	session_id: string
}

type ErrorMessage = {
	type: "error"
}

// Newer Claude Code CLI versions (2.1+) emit rate_limit_event as a top-level type
// rather than as a system subtype.
type RateLimitEvent = {
	type: "rate_limit_event"
	rate_limit_info?: Record<string, unknown>
	// Legacy format fields (older CLI versions)
	message?: string
	retryAfterSeconds?: number
}

// User messages can appear in the stream when Claude Code executes tools
// and returns tool results. These should be ignored by Cline since we manage
// our own tool execution.
type UserMessage = {
	type: "user"
	message: {
		role: "user"
		content: unknown[]
	}
	session_id: string
}

type ResultMessage = {
	type: "result"
	subtype: "success" | "error" | "error_max_turns"
	total_cost_usd: number
	is_error: boolean
	duration_ms: number
	duration_api_ms: number
	num_turns: number
	result: string
	session_id: string
}

export type ClaudeCodeMessage = InitMessage | AssistantMessage | ErrorMessage | ResultMessage | RateLimitEvent | UserMessage
