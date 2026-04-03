/**
 * Message Translator
 *
 * Translates SDK AgentEvent stream into ClineMessage[] that the existing
 * webview understands. This is the core bridge between the SDK's event
 * model and the classic extension's message format.
 *
 * The webview renders a list of ClineMessage objects. Each message has:
 * - ts: timestamp
 * - type: "ask" | "say"
 * - ask/say: specific subtype
 * - text: content (often JSON-encoded for structured data)
 * - partial: true if still streaming
 * - reasoning: reasoning/thinking text
 *
 * The SDK emits AgentEvent objects during execution:
 * - iteration_start/end: LLM call boundaries
 * - content_start/update/end: text, reasoning, and tool events
 * - usage: token counts and costs
 * - done: agent finished
 * - error: agent error
 * - notice: recovery/status messages
 */

import type {
	ClineApiReqInfo,
	ClineAskQuestion,
	ClineMessage,
	ClineSayTool,
} from "@shared/ExtensionMessage"

// ---------------------------------------------------------------------------
// SDK AgentEvent types (replicated here to avoid tight coupling to the SDK
// package at the type level — these match @clinebot/agents AgentEvent).
// ---------------------------------------------------------------------------

export type AgentContentType = "text" | "reasoning" | "tool"

export interface AgentEventMetadata {
	agentId?: string
	conversationId?: string
	parentAgentId?: string | null
}

export interface AgentContentStartEvent extends AgentEventMetadata {
	type: "content_start"
	contentType: AgentContentType
	text?: string
	accumulated?: string
	reasoning?: string
	redacted?: boolean
	toolName?: string
	toolCallId?: string
	input?: unknown
}

export interface AgentContentUpdateEvent extends AgentEventMetadata {
	type: "content_update"
	contentType: "tool"
	toolName?: string
	toolCallId?: string
	update: unknown
}

export interface AgentContentEndEvent extends AgentEventMetadata {
	type: "content_end"
	contentType: AgentContentType
	text?: string
	reasoning?: string
	toolName?: string
	toolCallId?: string
	output?: unknown
	error?: string
	durationMs?: number
}

export interface AgentIterationStartEvent extends AgentEventMetadata {
	type: "iteration_start"
	iteration: number
}

export interface AgentIterationEndEvent extends AgentEventMetadata {
	type: "iteration_end"
	iteration: number
	hadToolCalls: boolean
	toolCallCount: number
}

export interface AgentUsageEvent extends AgentEventMetadata {
	type: "usage"
	inputTokens: number
	outputTokens: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	cost?: number
	totalInputTokens: number
	totalCacheReadTokens?: number
	totalCacheWriteTokens?: number
	totalOutputTokens: number
	totalCost?: number
}

export interface AgentNoticeEvent extends AgentEventMetadata {
	type: "notice"
	noticeType: "recovery" | "stop"
	message: string
	displayRole?: "system" | "status"
	reason?: "api_error" | "invalid_tool_call" | "tool_execution_failed" | "mistake_limit"
	metadata?: Record<string, unknown>
}

export type AgentFinishReason = "completed" | "max_iterations" | "aborted" | "mistake_limit" | "error"

export interface AgentDoneEvent extends AgentEventMetadata {
	type: "done"
	reason: AgentFinishReason
	text: string
	iterations: number
	usage?: {
		inputTokens: number
		outputTokens: number
		cacheReadTokens?: number
		cacheWriteTokens?: number
		totalCost?: number
	}
}

export interface AgentErrorEvent extends AgentEventMetadata {
	type: "error"
	error: Error
	recoverable: boolean
	iteration: number
}

export type AgentEvent =
	| AgentContentStartEvent
	| AgentContentUpdateEvent
	| AgentContentEndEvent
	| AgentIterationStartEvent
	| AgentIterationEndEvent
	| AgentUsageEvent
	| AgentNoticeEvent
	| AgentDoneEvent
	| AgentErrorEvent

// ---------------------------------------------------------------------------
// Message update descriptor — tells the caller what changed
// ---------------------------------------------------------------------------

export interface MessageUpdate {
	/** Indices of messages that were added */
	added: number[]
	/** Indices of messages that were modified in-place */
	modified: number[]
}

// ---------------------------------------------------------------------------
// Tool name mapping: SDK tool names → ClineSayTool tool names
// ---------------------------------------------------------------------------

/** Maps an SDK tool name + input to the ClineSayTool format */
function mapToolToSayTool(toolName: string, input: unknown): ClineSayTool | undefined {
	const inp = (input ?? {}) as Record<string, unknown>

	switch (toolName) {
		case "read_files":
			return {
				tool: "readFile",
				path: extractPath(inp),
				content: typeof inp.content === "string" ? inp.content : undefined,
			}
		case "search_codebase":
			return {
				tool: "searchFiles",
				path: extractPath(inp),
				regex: typeof inp.regex === "string" ? inp.regex : typeof inp.pattern === "string" ? inp.pattern : undefined,
				filePattern: typeof inp.file_pattern === "string" ? inp.file_pattern : undefined,
				content: typeof inp.content === "string" ? inp.content : undefined,
			}
		case "editor":
			return {
				tool: "editedExistingFile",
				path: extractPath(inp),
				diff: typeof inp.diff === "string" ? inp.diff : undefined,
				content: typeof inp.content === "string" ? inp.content : undefined,
			}
		case "apply_patch":
			return {
				tool: "editedExistingFile",
				path: extractPath(inp),
				diff: typeof inp.patch === "string" ? inp.patch : typeof inp.diff === "string" ? inp.diff : undefined,
			}
		case "fetch_web_content": {
			const url = typeof inp.url === "string" ? inp.url : undefined
			// If it looks like a search query rather than URL, use webSearch
			const isSearch = !url || (!url.startsWith("http://") && !url.startsWith("https://"))
			return {
				tool: isSearch ? "webSearch" : "webFetch",
				path: url,
				content: typeof inp.query === "string" ? inp.query : undefined,
			}
		}
		case "skills":
			return {
				tool: "useSkill",
				path: typeof inp.skill === "string" ? inp.skill : typeof inp.name === "string" ? inp.name : undefined,
			}
		default:
			// Unknown tools (including MCP tools) — use a generic representation
			return undefined
	}
}

function extractPath(inp: Record<string, unknown>): string | undefined {
	if (typeof inp.path === "string") return inp.path
	if (typeof inp.file === "string") return inp.file
	if (typeof inp.paths === "string") return inp.paths
	if (Array.isArray(inp.paths) && inp.paths.length > 0 && typeof inp.paths[0] === "string") return inp.paths[0]
	return undefined
}

/**
 * Determines if an SDK tool name maps to a "command" in the webview
 * (i.e., shell execution) vs a "tool" (file operations, search, etc.)
 */
function isCommandTool(toolName: string): boolean {
	return toolName === "run_commands"
}

/**
 * Determines if an SDK tool name is an "ask" tool (asks the user a question)
 */
function isAskTool(toolName: string): boolean {
	return toolName === "ask_question" || toolName === "ask_followup_question"
}

// ---------------------------------------------------------------------------
// MessageTranslator
// ---------------------------------------------------------------------------

export class MessageTranslator {
	private messages: ClineMessage[] = []
	private currentIteration = 0
	private currentApiReqIndex = -1
	private currentTextIndex = -1
	private currentReasoningIndex = -1
	private accumulatedText = ""
	private accumulatedReasoning = ""

	// Track active tool calls by toolCallId
	private activeToolCalls = new Map<
		string,
		{
			messageIndex: number
			toolName: string
		}
	>()

	/**
	 * Process an SDK AgentEvent and update the internal ClineMessage array.
	 * Returns a MessageUpdate describing what changed.
	 */
	processEvent(event: AgentEvent): MessageUpdate {
		switch (event.type) {
			case "iteration_start":
				return this.handleIterationStart(event)
			case "iteration_end":
				return this.handleIterationEnd(event)
			case "content_start":
				return this.handleContentStart(event)
			case "content_update":
				return this.handleContentUpdate(event)
			case "content_end":
				return this.handleContentEnd(event)
			case "usage":
				return this.handleUsage(event)
			case "done":
				return this.handleDone(event)
			case "error":
				return this.handleError(event)
			case "notice":
				return this.handleNotice(event)
			default:
				return { added: [], modified: [] }
		}
	}

	/** Get the current array of ClineMessages */
	getMessages(): ClineMessage[] {
		return this.messages
	}

	/** Get the current iteration number */
	getCurrentIteration(): number {
		return this.currentIteration
	}

	/** Reset all state (for new task) */
	reset(): void {
		this.messages = []
		this.currentIteration = 0
		this.currentApiReqIndex = -1
		this.currentTextIndex = -1
		this.currentReasoningIndex = -1
		this.accumulatedText = ""
		this.accumulatedReasoning = ""
		this.activeToolCalls.clear()
	}

	// -----------------------------------------------------------------------
	// Event handlers
	// -----------------------------------------------------------------------

	private handleIterationStart(event: AgentIterationStartEvent): MessageUpdate {
		this.currentIteration = event.iteration

		// Finalize any in-progress text/reasoning from previous iteration
		this.finalizeStreaming()

		// Add api_req_started message
		const reqInfo: ClineApiReqInfo = {
			request: "",
			tokensIn: 0,
			tokensOut: 0,
			cost: 0,
		}

		const msg: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "api_req_started",
			text: JSON.stringify(reqInfo),
		}

		this.currentApiReqIndex = this.messages.length
		this.messages.push(msg)

		return { added: [this.currentApiReqIndex], modified: [] }
	}

	private handleIterationEnd(_event: AgentIterationEndEvent): MessageUpdate {
		// Finalize any in-progress streaming
		const modified = this.finalizeStreaming()
		return { added: [], modified }
	}

	private handleContentStart(event: AgentContentStartEvent): MessageUpdate {
		switch (event.contentType) {
			case "text":
				return this.handleTextStart(event)
			case "reasoning":
				return this.handleReasoningStart(event)
			case "tool":
				return this.handleToolStart(event)
			default:
				return { added: [], modified: [] }
		}
	}

	private handleTextStart(event: AgentContentStartEvent): MessageUpdate {
		const delta = event.text ?? ""
		this.accumulatedText += delta

		if (this.currentTextIndex === -1) {
			// Create new streaming text message
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "text",
				text: this.accumulatedText,
				partial: true,
			}
			this.currentTextIndex = this.messages.length
			this.messages.push(msg)
			return { added: [this.currentTextIndex], modified: [] }
		} else {
			// Update existing streaming text message
			this.messages[this.currentTextIndex] = {
				...this.messages[this.currentTextIndex],
				text: this.accumulatedText,
			}
			return { added: [], modified: [this.currentTextIndex] }
		}
	}

	private handleReasoningStart(event: AgentContentStartEvent): MessageUpdate {
		const delta = event.reasoning ?? ""
		this.accumulatedReasoning += delta

		if (this.currentReasoningIndex === -1) {
			// Create new streaming reasoning message
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "reasoning",
				text: this.accumulatedReasoning,
				partial: true,
			}
			this.currentReasoningIndex = this.messages.length
			this.messages.push(msg)
			return { added: [this.currentReasoningIndex], modified: [] }
		} else {
			// Update existing streaming reasoning message
			this.messages[this.currentReasoningIndex] = {
				...this.messages[this.currentReasoningIndex],
				text: this.accumulatedReasoning,
			}
			return { added: [], modified: [this.currentReasoningIndex] }
		}
	}

	private handleToolStart(event: AgentContentStartEvent): MessageUpdate {
		const toolName = event.toolName ?? "unknown"
		const toolCallId = event.toolCallId ?? `tool_${Date.now()}`
		const input = event.input

		// Finalize any in-progress text/reasoning before tool
		const modified = this.finalizeStreaming()

		if (isAskTool(toolName)) {
			return this.handleAskToolStart(event, toolCallId, modified)
		}

		if (isCommandTool(toolName)) {
			return this.handleCommandToolStart(event, toolCallId, modified)
		}

		// Regular tool (file ops, search, web, etc.)
		return this.handleRegularToolStart(event, toolName, toolCallId, modified)
	}

	private handleAskToolStart(
		event: AgentContentStartEvent,
		toolCallId: string,
		previousModified: number[],
	): MessageUpdate {
		const inp = (event.input ?? {}) as Record<string, unknown>
		const question = typeof inp.question === "string" ? inp.question : typeof inp.text === "string" ? inp.text : ""
		const options =
			Array.isArray(inp.options) ? inp.options.filter((o): o is string => typeof o === "string") : undefined

		const askData: ClineAskQuestion = { question, options }

		const msg: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "followup",
			text: JSON.stringify(askData),
		}

		const idx = this.messages.length
		this.messages.push(msg)
		this.activeToolCalls.set(toolCallId, { messageIndex: idx, toolName: event.toolName ?? "ask_question" })

		return { added: [idx], modified: previousModified }
	}

	private handleCommandToolStart(
		event: AgentContentStartEvent,
		toolCallId: string,
		previousModified: number[],
	): MessageUpdate {
		const inp = (event.input ?? {}) as Record<string, unknown>
		const command = typeof inp.command === "string" ? inp.command : JSON.stringify(inp)

		const msg: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "command",
			text: command,
		}

		const idx = this.messages.length
		this.messages.push(msg)
		this.activeToolCalls.set(toolCallId, { messageIndex: idx, toolName: "run_commands" })

		return { added: [idx], modified: previousModified }
	}

	private handleRegularToolStart(
		event: AgentContentStartEvent,
		toolName: string,
		toolCallId: string,
		previousModified: number[],
	): MessageUpdate {
		const sayTool = mapToolToSayTool(toolName, event.input)

		if (sayTool) {
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "tool",
				text: JSON.stringify(sayTool),
			}

			const idx = this.messages.length
			this.messages.push(msg)
			this.activeToolCalls.set(toolCallId, { messageIndex: idx, toolName })

			return { added: [idx], modified: previousModified }
		}

		// MCP or unknown tool — use mcp_server_request_started
		const msg: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "mcp_server_request_started",
			text: JSON.stringify({ tool: toolName, arguments: JSON.stringify(event.input) }),
		}

		const idx = this.messages.length
		this.messages.push(msg)
		this.activeToolCalls.set(toolCallId, { messageIndex: idx, toolName })

		return { added: [idx], modified: previousModified }
	}

	private handleContentUpdate(event: AgentContentUpdateEvent): MessageUpdate {
		const toolCallId = event.toolCallId ?? ""
		const active = this.activeToolCalls.get(toolCallId)

		if (!active) {
			return { added: [], modified: [] }
		}

		// For command tools, append output
		if (isCommandTool(active.toolName)) {
			const updateText = typeof event.update === "string" ? event.update : JSON.stringify(event.update)
			// Append as command_output
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "command_output",
				text: updateText,
				partial: true,
			}
			const idx = this.messages.length
			this.messages.push(msg)
			return { added: [idx], modified: [] }
		}

		return { added: [], modified: [] }
	}

	private handleContentEnd(event: AgentContentEndEvent): MessageUpdate {
		switch (event.contentType) {
			case "text":
				return this.handleTextEnd(event)
			case "reasoning":
				return this.handleReasoningEnd()
			case "tool":
				return this.handleToolEnd(event)
			default:
				return { added: [], modified: [] }
		}
	}

	private handleTextEnd(_event: AgentContentEndEvent): MessageUpdate {
		const modified: number[] = []
		if (this.currentTextIndex !== -1) {
			this.messages[this.currentTextIndex] = {
				...this.messages[this.currentTextIndex],
				text: this.accumulatedText,
				partial: false,
			}
			modified.push(this.currentTextIndex)
			this.currentTextIndex = -1
			this.accumulatedText = ""
		}
		return { added: [], modified }
	}

	private handleReasoningEnd(): MessageUpdate {
		const modified: number[] = []
		if (this.currentReasoningIndex !== -1) {
			this.messages[this.currentReasoningIndex] = {
				...this.messages[this.currentReasoningIndex],
				text: this.accumulatedReasoning,
				partial: false,
			}
			modified.push(this.currentReasoningIndex)
			this.currentReasoningIndex = -1
			this.accumulatedReasoning = ""
		}
		return { added: [], modified }
	}

	private handleToolEnd(event: AgentContentEndEvent): MessageUpdate {
		const toolCallId = event.toolCallId ?? ""
		const active = this.activeToolCalls.get(toolCallId)
		const added: number[] = []
		const modified: number[] = []

		if (active && isCommandTool(active.toolName)) {
			// Finalize command — add final output if present
			if (event.output !== undefined || event.error) {
				const outputText = event.error
					? `Error: ${event.error}`
					: typeof event.output === "string"
						? event.output
						: JSON.stringify(event.output)

				const msg: ClineMessage = {
					ts: Date.now(),
					type: "say",
					say: "command_output",
					text: outputText,
					commandCompleted: true,
				}
				const idx = this.messages.length
				this.messages.push(msg)
				added.push(idx)
			}
		} else if (active && event.error) {
			// Tool failed — add error message
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: `Tool "${event.toolName}" failed: ${event.error}`,
			}
			const idx = this.messages.length
			this.messages.push(msg)
			added.push(idx)
		} else if (active) {
			// Regular tool completed — if it's an MCP tool, add response
			const sayTool = mapToolToSayTool(active.toolName, undefined)
			if (!sayTool) {
				// MCP/unknown tool — add response message
				const outputText = typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? "")
				const msg: ClineMessage = {
					ts: Date.now(),
					type: "say",
					say: "mcp_server_response",
					text: outputText,
				}
				const idx = this.messages.length
				this.messages.push(msg)
				added.push(idx)
			}
		}

		// Clean up active tool call
		if (toolCallId) {
			this.activeToolCalls.delete(toolCallId)
		}

		return { added, modified }
	}

	private handleUsage(event: AgentUsageEvent): MessageUpdate {
		if (this.currentApiReqIndex === -1) {
			return { added: [], modified: [] }
		}

		// Update the api_req_started message with usage info
		const existing = this.messages[this.currentApiReqIndex]
		let reqInfo: ClineApiReqInfo = {}
		try {
			reqInfo = JSON.parse(existing.text ?? "{}") as ClineApiReqInfo
		} catch {
			reqInfo = {}
		}

		reqInfo.tokensIn = event.totalInputTokens
		reqInfo.tokensOut = event.totalOutputTokens
		reqInfo.cacheWrites = event.cacheWriteTokens
		reqInfo.cacheReads = event.cacheReadTokens
		reqInfo.cost = event.totalCost

		this.messages[this.currentApiReqIndex] = {
			...existing,
			text: JSON.stringify(reqInfo),
		}

		return { added: [], modified: [this.currentApiReqIndex] }
	}

	private handleDone(event: AgentDoneEvent): MessageUpdate {
		// Finalize any in-progress streaming
		const modified = this.finalizeStreaming()
		const added: number[] = []

		if (event.reason === "completed" || event.reason === "aborted") {
			// Add completion_result message
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "completion_result",
				text: event.text || (event.reason === "aborted" ? "Task was aborted." : "Task completed."),
			}
			const idx = this.messages.length
			this.messages.push(msg)
			added.push(idx)
		} else if (event.reason === "error") {
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: event.text || "An error occurred.",
			}
			const idx = this.messages.length
			this.messages.push(msg)
			added.push(idx)
		} else if (event.reason === "max_iterations") {
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: event.text || `Reached maximum iterations (${event.iterations}).`,
			}
			const idx = this.messages.length
			this.messages.push(msg)
			added.push(idx)
		} else if (event.reason === "mistake_limit") {
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error",
				text: event.text || "Stopped due to repeated mistakes.",
			}
			const idx = this.messages.length
			this.messages.push(msg)
			added.push(idx)
		}

		return { added, modified }
	}

	private handleError(event: AgentErrorEvent): MessageUpdate {
		if (event.recoverable) {
			// Recoverable error — show as retry info
			const msg: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "error_retry",
				text: event.error.message,
			}
			const idx = this.messages.length
			this.messages.push(msg)
			return { added: [idx], modified: [] }
		}

		// Non-recoverable error
		const modified: number[] = []

		// Update api_req_started with failure if we have one
		if (this.currentApiReqIndex !== -1) {
			const existing = this.messages[this.currentApiReqIndex]
			let reqInfo: ClineApiReqInfo = {}
			try {
				reqInfo = JSON.parse(existing.text ?? "{}") as ClineApiReqInfo
			} catch {
				reqInfo = {}
			}
			reqInfo.cancelReason = "streaming_failed"
			reqInfo.streamingFailedMessage = event.error.message
			this.messages[this.currentApiReqIndex] = {
				...existing,
				text: JSON.stringify(reqInfo),
			}
			modified.push(this.currentApiReqIndex)
		}

		const msg: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "error",
			text: event.error.message,
		}
		const idx = this.messages.length
		this.messages.push(msg)

		return { added: [idx], modified }
	}

	private handleNotice(event: AgentNoticeEvent): MessageUpdate {
		const say = event.reason === "api_error" ? "error_retry" : "info"
		const msg: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say,
			text: event.message,
		}
		const idx = this.messages.length
		this.messages.push(msg)
		return { added: [idx], modified: [] }
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Finalize any in-progress streaming text/reasoning messages.
	 * Returns indices of modified messages.
	 */
	private finalizeStreaming(): number[] {
		const modified: number[] = []

		if (this.currentTextIndex !== -1) {
			this.messages[this.currentTextIndex] = {
				...this.messages[this.currentTextIndex],
				text: this.accumulatedText,
				partial: false,
			}
			modified.push(this.currentTextIndex)
			this.currentTextIndex = -1
			this.accumulatedText = ""
		}

		if (this.currentReasoningIndex !== -1) {
			this.messages[this.currentReasoningIndex] = {
				...this.messages[this.currentReasoningIndex],
				text: this.accumulatedReasoning,
				partial: false,
			}
			modified.push(this.currentReasoningIndex)
			this.currentReasoningIndex = -1
			this.accumulatedReasoning = ""
		}

		return modified
	}
}
