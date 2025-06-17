type InitMessage = {
	type: "system"
	subtype: "init"
	session_id: string
	tools: string[]
	mcp_servers: string[]
}

type ClaudeCodeContent = {
	type: "text"
	text: string
}

type AssistantMessage = {
	type: "assistant"
	message: {
		id: string
		type: "message"
		role: "assistant"
		model: string
		content: ClaudeCodeContent[]
		stop_reason: null
		stop_sequence: null
		usage: {
			input_tokens: number
			cache_creation_input_tokens?: number
			cache_read_input_tokens?: number
			output_tokens: number
			service_tier: "standard"
		}
	}
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
