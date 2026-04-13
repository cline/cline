// Replaces classic message streaming from src/core/task/index.ts (see origin/main)
//
// Translates SDK session events into ClineMessage[] for webview consumption.
// The webview expects ClineMessage objects with ask/say types; this module
// maps SDK CoreSessionEvent and AgentEvent types to that format.
//
// Key mappings:
// - SDK "chunk" event (agent stream) → ClineMessage say="text" with partial=true
// - SDK "agent_event" content_start (text) → ClineMessage say="text" with partial=true
// - SDK "agent_event" content_start (reasoning) → ClineMessage say="reasoning" with partial=true
// - SDK "agent_event" content_start (tool) → ClineMessage say="tool" with partial=true
// - SDK "agent_event" content_end → ClineMessage with partial=false
// - SDK "agent_event" done → ClineMessage say="completion_result"
// - SDK "agent_event" error → ClineMessage say="error"
// - SDK "ended" event → finalizes the session

import type { CoreSessionEvent } from "@clinebot/core"
import type { AgentEvent } from "@clinebot/shared"
import type { ClineMessage, ClineSay } from "@shared/ExtensionMessage"
import { Logger } from "@shared/services/Logger"

// ---------------------------------------------------------------------------
// Translation result
// ---------------------------------------------------------------------------

/**
 * Result of translating a single SDK event into ClineMessages.
 * May produce zero or more messages.
 */
export interface TranslationResult {
	/** Messages produced by this event */
	messages: ClineMessage[]
	/** Whether the session has ended */
	sessionEnded: boolean
	/** Whether the agent turn is complete */
	turnComplete: boolean
	/** Usage info if available */
	usage?: {
		tokensIn: number
		tokensOut: number
		cacheWrites?: number
		cacheReads?: number
		totalCost?: number
	}
}

// ---------------------------------------------------------------------------
// State tracking for partial messages
// ---------------------------------------------------------------------------

/**
 * Tracks the state of streaming content to properly handle
 * partial message updates.
 */
export class MessageTranslatorState {
	/** Current streaming text message timestamp (used for dedup) */
	private streamingTextTs: number | undefined
	/** Current streaming reasoning message timestamp */
	private streamingReasoningTs: number | undefined
	/** Current streaming tool message timestamp */
	private streamingToolTs: number | undefined
	/** Monotonic counter for message timestamps */
	private tsCounter = Date.now()

	/** Generate a unique timestamp for a new message */
	nextTs(): number {
		return ++this.tsCounter
	}

	/** Get and increment for streaming text */
	getStreamingTextTs(): number {
		if (!this.streamingTextTs) {
			this.streamingTextTs = this.nextTs()
		}
		return this.streamingTextTs
	}

	/** Clear streaming text (content ended) */
	clearStreamingText(): number {
		const ts = this.streamingTextTs ?? this.nextTs()
		this.streamingTextTs = undefined
		return ts
	}

	/** Get and increment for streaming reasoning */
	getStreamingReasoningTs(): number {
		if (!this.streamingReasoningTs) {
			this.streamingReasoningTs = this.nextTs()
		}
		return this.streamingReasoningTs
	}

	/** Clear streaming reasoning (content ended) */
	clearStreamingReasoning(): number {
		const ts = this.streamingReasoningTs ?? this.nextTs()
		this.streamingReasoningTs = undefined
		return ts
	}

	/** Get streaming tool ts */
	getStreamingToolTs(): number {
		if (!this.streamingToolTs) {
			this.streamingToolTs = this.nextTs()
		}
		return this.streamingToolTs
	}

	/** Clear streaming tool */
	clearStreamingTool(): number {
		const ts = this.streamingToolTs ?? this.nextTs()
		this.streamingToolTs = undefined
		return ts
	}

	/** Reset all streaming state (new turn) */
	reset(): void {
		this.streamingTextTs = undefined
		this.streamingReasoningTs = undefined
		this.streamingToolTs = undefined
	}
}

// ---------------------------------------------------------------------------
// Agent event translation
// ---------------------------------------------------------------------------

/**
 * Translate an SDK AgentEvent into ClineMessage(s).
 */
function translateAgentEvent(event: AgentEvent, state: MessageTranslatorState): ClineMessage[] {
	const messages: ClineMessage[] = []

	switch (event.type) {
		case "content_start": {
			switch (event.contentType) {
				case "text": {
					const ts = state.getStreamingTextTs()
					messages.push({
						ts,
						type: "say",
						say: "text",
						text: event.text ?? event.accumulated ?? "",
						partial: true,
					})
					break
				}
				case "reasoning": {
					const ts = state.getStreamingReasoningTs()
					messages.push({
						ts,
						type: "say",
						say: "reasoning",
						reasoning: event.reasoning ?? "",
						partial: true,
					})
					break
				}
				case "tool": {
					const ts = state.getStreamingToolTs()
					const toolName = event.toolName ?? "unknown"
					const input = event.input
					messages.push({
						ts,
						type: "say",
						say: "tool",
						text: formatToolStartText(toolName, input),
						partial: true,
					})
					break
				}
			}
			break
		}

		case "content_update": {
			// Content updates provide incremental progress for tool calls
			if (event.contentType === "tool") {
				const ts = state.getStreamingToolTs()
				const toolName = event.toolName ?? "unknown"
				messages.push({
					ts,
					type: "say",
					say: "tool",
					text: formatToolUpdateText(toolName, event.update),
					partial: true,
				})
			}
			break
		}

		case "content_end": {
			switch (event.contentType) {
				case "text": {
					const ts = state.clearStreamingText()
					messages.push({
						ts,
						type: "say",
						say: "text",
						text: event.text ?? "",
						partial: false,
					})
					break
				}
				case "reasoning": {
					const ts = state.clearStreamingReasoning()
					messages.push({
						ts,
						type: "say",
						say: "reasoning",
						reasoning: event.reasoning ?? "",
						partial: false,
					})
					break
				}
				case "tool": {
					const ts = state.clearStreamingTool()
					const toolName = event.toolName ?? "unknown"
					messages.push({
						ts,
						type: "say",
						say: "tool",
						text: formatToolEndText(toolName, event.output, event.error),
						partial: false,
					})
					break
				}
			}
			break
		}

		case "iteration_start": {
			// New iteration — reset streaming state for the new turn
			state.reset()
			break
		}

		case "iteration_end": {
			// Iteration ended — no specific message needed
			break
		}

		case "notice": {
			// Agent notices are informational
			messages.push({
				ts: state.nextTs(),
				type: "say",
				say: "info",
				text: event.message ?? "",
				partial: false,
			})
			break
		}

		case "usage": {
			// Usage events are captured in the result, not as messages
			// They'll be included in the TranslationResult.usage field
			break
		}

		case "done": {
			// Agent turn is complete
			// AgentDoneEvent has: reason, text, iterations, usage?
			messages.push({
				ts: state.nextTs(),
				type: "say",
				say: "completion_result",
				text: event.text ?? "",
				partial: false,
			})
			break
		}

		case "error": {
			messages.push({
				ts: state.nextTs(),
				type: "say",
				say: "error",
				text: event.error.message ?? "Unknown error",
				partial: false,
			})
			break
		}

		default: {
			// Log unhandled event types for debugging
			Logger.warn(`[MessageTranslator] Unhandled agent event type: ${(event as AgentEvent).type}`)
			break
		}
	}

	return messages
}

// ---------------------------------------------------------------------------
// Core session event translation
// ---------------------------------------------------------------------------

/**
 * Translate an SDK CoreSessionEvent into a TranslationResult.
 *
 * This is the primary entry point for event translation. It handles
 * both top-level session events (chunk, ended, status) and nested
 * agent events.
 */
export function translateSessionEvent(event: CoreSessionEvent, state: MessageTranslatorState): TranslationResult {
	const result: TranslationResult = {
		messages: [],
		sessionEnded: false,
		turnComplete: false,
	}

	switch (event.type) {
		case "chunk": {
			// Raw chunk events from the session stream
			const payload = event.payload
			if (payload.stream === "agent") {
				// Agent text streaming — emit as partial text message
				const ts = state.getStreamingTextTs()
				result.messages.push({
					ts,
					type: "say",
					say: "text",
					text: payload.chunk,
					partial: true,
				})
			}
			// stdout/stderr chunks are not displayed as messages
			break
		}

		case "agent_event": {
			// Agent events contain structured content (text, reasoning, tools)
			const agentMessages = translateAgentEvent(event.payload.event, state)
			result.messages.push(...agentMessages)

			// Check for done/error events
			if (event.payload.event.type === "done") {
				result.turnComplete = true
			}
			if (event.payload.event.type === "error") {
				result.turnComplete = true
			}

			// Extract usage from usage events
			if (event.payload.event.type === "usage") {
				result.usage = {
					tokensIn: event.payload.event.inputTokens ?? 0,
					tokensOut: event.payload.event.outputTokens ?? 0,
				}
			}
			break
		}

		case "ended": {
			result.sessionEnded = true
			result.turnComplete = true
			state.reset()
			break
		}

		case "hook": {
			// Tool hook events — translate to hook_status messages
			const payload = event.payload
			const hookName = payload.hookEventName
			const toolName = payload.toolName

			if (hookName === "tool_call") {
				result.messages.push({
					ts: state.nextTs(),
					type: "say",
					say: "hook_status" as ClineSay,
					text: toolName ? `Running ${toolName}...` : "Running tool...",
					partial: false,
				})
			} else if (hookName === "tool_result") {
				result.messages.push({
					ts: state.nextTs(),
					type: "say",
					say: "hook_status" as ClineSay,
					text: toolName ? `${toolName} completed` : "Tool completed",
					partial: false,
				})
			}
			break
		}

		case "status": {
			// Status updates — informational
			Logger.log(`[MessageTranslator] Session status: ${event.payload.status}`)
			break
		}

		case "team_progress":
		case "pending_prompts":
		case "pending_prompt_submitted": {
			// These are handled by the team/subagent system, not translated
			// to ClineMessages at this layer
			break
		}

		default: {
			Logger.warn(`[MessageTranslator] Unhandled session event type: ${(event as CoreSessionEvent).type}`)
			break
		}
	}

	return result
}

// ---------------------------------------------------------------------------
// Tool text formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format the start of a tool call as human-readable text.
 */
function formatToolStartText(toolName: string, input?: unknown): string {
	if (!input) return `[${toolName}]`

	try {
		const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2)
		// Truncate very long inputs for display
		const maxLen = 500
		const truncated = inputStr.length > maxLen ? `${inputStr.slice(0, maxLen)}...` : inputStr
		return `[${toolName}]\n${truncated}`
	} catch {
		return `[${toolName}]`
	}
}

/**
 * Format a tool update as human-readable text.
 */
function formatToolUpdateText(toolName: string, update?: unknown): string {
	if (!update) return `[${toolName}] running...`

	try {
		const updateStr = typeof update === "string" ? update : JSON.stringify(update)
		const maxLen = 200
		const truncated = updateStr.length > maxLen ? `${updateStr.slice(0, maxLen)}...` : updateStr
		return `[${toolName}] ${truncated}`
	} catch {
		return `[${toolName}] running...`
	}
}

/**
 * Format the end of a tool call as human-readable text.
 */
function formatToolEndText(toolName: string, output?: unknown, error?: string): string {
	if (error) {
		return `[${toolName}] Error: ${error}`
	}

	if (!output) return `[${toolName}] Completed`

	try {
		const outputStr = typeof output === "string" ? output : JSON.stringify(output)
		const maxLen = 500
		const truncated = outputStr.length > maxLen ? `${outputStr.slice(0, maxLen)}...` : outputStr
		return `[${toolName}] Result:\n${truncated}`
	} catch {
		return `[${toolName}] Completed`
	}
}

// ---------------------------------------------------------------------------
// HistoryItem ↔ SessionRecord mapping
// ---------------------------------------------------------------------------

/**
 * Map a HistoryItem (classic format) to a partial SessionRecord-like object.
 * Used when loading tasks from legacy storage.
 */
export function historyItemToSessionFields(item: {
	id: string
	task: string
	ts: number
	tokensIn: number
	tokensOut: number
	totalCost: number
	modelId?: string
}): {
	sessionId: string
	prompt: string
	startedAt: string
	usage: { tokensIn: number; tokensOut: number; totalCost: number }
	modelId?: string
} {
	return {
		sessionId: item.id,
		prompt: item.task,
		startedAt: new Date(item.ts).toISOString(),
		usage: {
			tokensIn: item.tokensIn,
			tokensOut: item.tokensOut,
			totalCost: item.totalCost,
		},
		modelId: item.modelId,
	}
}
