import type { Anthropic } from "@anthropic-ai/sdk"

type InitMessage = {
	type: "system"
	subtype: "init"
	session_id: string
	tools: string[]
	mcp_servers: string[]
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
	cost_usd: number
	is_error: boolean
	duration_ms: number
	duration_api_ms: number
	num_turns: number
	result: string
	total_cost: number
	session_id: string
}

export type ClaudeCodeMessage = InitMessage | AssistantMessage | ErrorMessage | ResultMessage
