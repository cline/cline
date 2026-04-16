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
//   IMPORTANT: The webview's ChatRow.tsx parses message.text as JSON when
//   say==="tool", expecting ClineSayTool format: {tool, path, content, ...}.
//   We must convert SDK tool names (read_files, editor, run_commands, etc.)
//   and their inputs to this format.
// - SDK "agent_event" content_end → ClineMessage with partial=false
// - SDK "agent_event" done → ClineMessage say="completion_result"
// - SDK "agent_event" error → ClineMessage say="error"
// - SDK "agent_event" usage → ClineMessage say="api_req_started" with ClineApiReqInfo JSON
// - SDK "ended" event → finalizes the session

import type { CoreSessionEvent } from "@clinebot/core"
import type { AgentEvent } from "@clinebot/shared"
import type { ClineApiReqInfo, ClineMessage, ClineSay, ClineSayTool } from "@shared/ExtensionMessage"
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
	/** Stored tool input from content_start — used at content_end which doesn't carry input */
	private streamingToolInput: unknown | undefined
	/** Stored tool name from content_start — used at content_end for consistency */
	private streamingToolName: string | undefined
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

	/** Store tool input from content_start for use at content_end */
	setStreamingToolContext(toolName: string, input: unknown): void {
		this.streamingToolName = toolName
		this.streamingToolInput = input
	}

	/** Get the stored tool input (from content_start) */
	getStreamingToolInput(): unknown | undefined {
		return this.streamingToolInput
	}

	/** Get the stored tool name (from content_start) */
	getStreamingToolName(): string | undefined {
		return this.streamingToolName
	}

	/** Clear streaming tool */
	clearStreamingTool(): number {
		const ts = this.streamingToolTs ?? this.nextTs()
		this.streamingToolTs = undefined
		this.streamingToolInput = undefined
		this.streamingToolName = undefined
		return ts
	}

	/** Reset all streaming state (new turn) */
	reset(): void {
		this.streamingTextTs = undefined
		this.streamingReasoningTs = undefined
		this.streamingToolTs = undefined
		this.streamingToolInput = undefined
		this.streamingToolName = undefined
	}
}

// ---------------------------------------------------------------------------
// SDK tool name → classic ClineSayTool mapping
// ---------------------------------------------------------------------------

/**
 * Map an SDK tool name and its input to a ClineSayTool object that the
 * webview's ChatRow.tsx can render.
 *
 * The webview does `JSON.parse(message.text) as ClineSayTool` when
 * `say === "tool"`, so the text MUST be valid ClineSayTool JSON.
 *
 * SDK tool names → classic tool names:
 *   read_files       → readFile
 *   editor           → editedExistingFile / newFileCreated
 *   apply_patch      → editedExistingFile
 *   run_commands     → (uses say="command", NOT say="tool")
 *   search_codebase  → searchFiles
 *   fetch_web_content → webFetch
 *   skills           → useSkill
 *   ask_question     → (not a visual tool — handled as text)
 *   MCP tools        → (passed through with tool name as-is)
 */
function sdkToolToClineSayTool(toolName: string, input?: unknown): ClineSayTool {
	// Parse input if it's a string (some SDK tools pass stringified JSON)
	const parsedInput = parseToolInput(input)

	switch (toolName) {
		case "read_files": {
			// SDK input: { files: [{ path, start_line?, end_line? }] }
			// Classic format: { tool: "readFile", path: "file.ts" }
			const filePath = extractFirstFilePath(parsedInput)
			return {
				tool: "readFile",
				path: filePath,
			}
		}

		case "editor": {
			// SDK input: { path, old_text?, new_text?, insert_line? }
			// Classic format: { tool: "editedExistingFile"|"newFileCreated", path, content/diff }
			const filePath = getStringField(parsedInput, "path") ?? ""
			const newText = getStringField(parsedInput, "new_text")
			const oldText = getStringField(parsedInput, "old_text")
			// If there's old_text, it's an edit; otherwise it's a create
			const isEdit = !!oldText
			return {
				tool: isEdit ? "editedExistingFile" : "newFileCreated",
				path: filePath,
				content: newText,
			}
		}

		case "apply_patch": {
			// SDK input: { path, patch }
			const filePath = getStringField(parsedInput, "path") ?? ""
			const patch = getStringField(parsedInput, "patch")
			return {
				tool: "editedExistingFile",
				path: filePath,
				diff: patch,
			}
		}

		case "search_codebase": {
			// SDK input: { queries: ["regex1", ...] }
			const queries = getArrayField(parsedInput, "queries")
			return {
				tool: "searchFiles",
				regex: queries?.join(", ") ?? getStringField(parsedInput, "queries") ?? "",
			}
		}

		case "fetch_web_content": {
			// SDK input: { url }
			const url = getStringField(parsedInput, "url") ?? ""
			return {
				tool: "webFetch",
				path: url,
			}
		}

		case "skills": {
			// SDK input: { skill_name }
			const skillName = getStringField(parsedInput, "skill_name") ?? getStringField(parsedInput, "name") ?? ""
			return {
				tool: "useSkill",
				path: skillName,
			}
		}

		default: {
			// MCP tools and unknown tools — pass through with the raw tool name.
			// The webview will render a generic tool display.
			// Try to extract a path from the input for display.
			const filePath =
				getStringField(parsedInput, "path") ??
				getStringField(parsedInput, "url") ??
				getStringField(parsedInput, "command") ??
				""
			return {
				tool: toolName as ClineSayTool["tool"],
				path: filePath,
			}
		}
	}
}

/**
 * Parse tool input into a record if it's a string or object.
 */
function parseToolInput(input: unknown): Record<string, unknown> | undefined {
	if (!input) return undefined
	if (typeof input === "object" && !Array.isArray(input)) {
		return input as Record<string, unknown>
	}
	if (typeof input === "string") {
		try {
			const parsed = JSON.parse(input)
			if (typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed
			}
		} catch {
			// Not JSON — return undefined
		}
	}
	return undefined
}

/** Extract the first file path from a read_files input */
function extractFirstFilePath(input: Record<string, unknown> | undefined): string {
	if (!input) return ""
	const files = input.files
	if (Array.isArray(files) && files.length > 0) {
		const first = files[0]
		if (typeof first === "string") return first
		if (typeof first === "object" && first !== null) {
			return ((first as Record<string, unknown>).path as string) ?? ""
		}
	}
	// Fallback: check for path or file_path fields
	return (input.path as string) ?? (input.file_path as string) ?? ""
}

/** Get a string field from a parsed input object */
function getStringField(input: Record<string, unknown> | undefined, field: string): string | undefined {
	if (!input) return undefined
	const value = input[field]
	if (typeof value === "string") return value
	return undefined
}

/** Get an array field from a parsed input object */
function getArrayField(input: Record<string, unknown> | undefined, field: string): string[] | undefined {
	if (!input) return undefined
	const value = input[field]
	if (Array.isArray(value)) return value.map(String)
	return undefined
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
					// The SDK emits MULTIPLE content_start events for streaming text.
					// Each has `text` (the delta) and `accumulated` (full text so far).
					// We use `accumulated` so the webview can update the message in-place
					// with the growing text, giving smooth streaming. Using `text` (delta)
					// would cause a "flip book" effect where each update replaces the
					// previous content with just the new chunk.
					const ts = state.getStreamingTextTs()
					messages.push({
						ts,
						type: "say",
						say: "text",
						text: event.accumulated ?? event.text ?? "",
						partial: true,
					})
					break
				}
				case "reasoning": {
					// Same pattern as text — use accumulated reasoning for smooth streaming
					const ts = state.getStreamingReasoningTs()
					const reasoning = event.reasoning ?? ""
					messages.push({
						ts,
						type: "say",
						say: "reasoning",
						reasoning,
						partial: true,
					})
					break
				}
				case "tool": {
					const toolName = event.toolName ?? "unknown"
					const input = event.input

					// Store tool context so content_end can use it
					// (content_end doesn't carry the input)
					state.setStreamingToolContext(toolName, input)

					// run_commands uses say="command" (not say="tool")
					// because the webview renders commands differently
					if (toolName === "run_commands") {
						const parsedInput = parseToolInput(input)
						const commands = getArrayField(parsedInput, "commands")
						const commandText = commands?.join(" && ") ?? getStringField(parsedInput, "commands") ?? ""
						messages.push({
							ts: state.getStreamingToolTs(),
							type: "say",
							say: "command",
							text: commandText,
							partial: true,
						})
						break
					}

					// All other tools → say="tool" with ClineSayTool JSON
					const sayTool = sdkToolToClineSayTool(toolName, input)
					messages.push({
						ts: state.getStreamingToolTs(),
						type: "say",
						say: "tool",
						text: JSON.stringify(sayTool),
						partial: true,
					})
					break
				}
			}
			break
		}

		case "content_update": {
			// Content updates provide incremental progress for tool calls.
			// For the webview, we don't need to push every update — the
			// content_start message with partial=true is sufficient until
			// content_end finalizes it. This avoids flooding the webview
			// with intermediate states.
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
					const toolName = event.toolName ?? "unknown"

					// run_commands → say="command_output" for the result
					if (toolName === "run_commands") {
						const ts = state.clearStreamingTool()
						const outputStr = typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? "")
						messages.push({
							ts,
							type: "say",
							say: "command_output",
							text: event.error ? `Error: ${event.error}` : outputStr,
							partial: false,
						})
						break
					}

					// All other tools → finalize the say="tool" message
					// Use the stored input from content_start since content_end
					// doesn't carry the input (S6-24 fix)
					const storedInput = state.getStreamingToolInput()
					const ts = state.clearStreamingTool()
					const sayTool = sdkToolToClineSayTool(toolName, storedInput)
					// If there's an error, include it in the tool message
					if (event.error) {
						messages.push({
							ts,
							type: "say",
							say: "tool",
							text: JSON.stringify(sayTool),
							partial: false,
						})
						// Also push an error message
						messages.push({
							ts: state.nextTs(),
							type: "say",
							say: "error",
							text: event.error,
							partial: false,
						})
					} else {
						messages.push({
							ts,
							type: "say",
							say: "tool",
							text: JSON.stringify(sayTool),
							partial: false,
						})
					}
					break
				}
			}
			break
		}

		case "iteration_start": {
			// New iteration — reset streaming state for the new turn
			state.reset()

			// Emit an api_req_started message for the webview's API request
			// spinner and cost display. The classic Task emits this before
			// each API request.
			messages.push({
				ts: state.nextTs(),
				type: "say",
				say: "api_req_started",
				text: JSON.stringify({
					request: undefined, // Will be filled in by usage event
				} satisfies ClineApiReqInfo),
				partial: false,
			})
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
			// Usage events carry token counts. In the classic system,
			// these are embedded in the api_req_started message's
			// ClineApiReqInfo. We emit a separate api_req_started update
			// with the usage data so the webview can display costs.
			const usageEvent = event as unknown as Record<string, unknown>
			const apiReqInfo: ClineApiReqInfo = {
				tokensIn: (usageEvent.inputTokens as number) ?? 0,
				tokensOut: (usageEvent.outputTokens as number) ?? 0,
				cacheWrites: (usageEvent.cacheWrites as number) ?? undefined,
				cacheReads: (usageEvent.cacheReads as number) ?? undefined,
			}
			messages.push({
				ts: state.nextTs(),
				type: "say",
				say: "api_req_started",
				text: JSON.stringify(apiReqInfo),
				partial: false,
			})
			break
		}

		case "done": {
			// Agent turn is complete
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
			// Raw chunk events from the session stream.
			// IMPORTANT: We do NOT emit these as text messages. The SDK sends
			// raw model output (which may contain JSON, tool call fragments, etc.)
			// as chunk events. The structured agent_event system (content_start,
			// content_update, content_end) is the proper way to get displayable
			// content. Emitting raw chunks would show JSON like
			// {"type":"iteration_start",...} in the webview.
			//
			// The chunk events are useful for logging but should not be
			// displayed to the user.
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
