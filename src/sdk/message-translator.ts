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
// - SDK "agent_event" content_start (tool: attempt_completion) → ClineMessage say="completion_result"
// - SDK "agent_event" content_end (tool: attempt_completion) → ClineMessage ask="completion_result"
// - SDK "agent_event" done → ClineMessage ask="completion_result" (only if attempt_completion not seen)
// - SDK "agent_event" error → ClineMessage say="error"
// - SDK "agent_event" usage → ClineMessage say="api_req_started" with ClineApiReqInfo JSON
// - SDK "ended" event → finalizes the session

import type { CoreSessionEvent } from "@clinebot/core"
import type { AgentEvent } from "@clinebot/shared"
import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
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

	/** Whether attempt_completion tool was called in this turn */
	private attemptCompletionSeen = false

	/** Mark that attempt_completion was called */
	setAttemptCompletionSeen(): void {
		this.attemptCompletionSeen = true
	}

	/** Check if attempt_completion was called in this turn */
	wasAttemptCompletionSeen(): boolean {
		return this.attemptCompletionSeen
	}

	/** Reset all streaming state (new turn) */
	reset(): void {
		this.streamingTextTs = undefined
		this.streamingReasoningTs = undefined
		this.streamingToolTs = undefined
		this.streamingToolInput = undefined
		this.streamingToolName = undefined
		this.attemptCompletionSeen = false
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
 *   read_files/read_file               → readFile
 *   list_files                         → listFilesTopLevel / listFilesRecursive
 *   list_code_definition_names         → listCodeDefinitionNames
 *   editor/replace_in_file             → editedExistingFile
 *   write_to_file                      → newFileCreated
 *   apply_patch                        → editedExistingFile
 *   delete_file                        → fileDeleted
 *   run_commands/execute_command       → (uses say="command", NOT say="tool")
 *   search_codebase/search_files       → searchFiles
 *   fetch_web_content/web_fetch        → webFetch
 *   web_search                         → webSearch
 *   skills/use_skill                   → useSkill
 *   ask_question/ask_followup_question → (not a visual tool — handled as text)
 *   MCP tools                          → (passed through with tool name as-is)
 */
function sdkToolToClineSayTool(toolName: string, input?: unknown): ClineSayTool {
	// Parse input if it's a string (some SDK tools pass stringified JSON)
	const parsedInput = parseToolInput(input)

	switch (toolName) {
		case "read_files":
		case "read_file": {
			const filePath = extractFirstFilePath(parsedInput)
			return {
				tool: "readFile",
				path: filePath,
			}
		}

		case "list_files": {
			const dirPath = getStringField(parsedInput, "path") ?? ""
			const recursive = getBooleanField(parsedInput, "recursive") ?? false
			return {
				tool: recursive ? "listFilesRecursive" : "listFilesTopLevel",
				path: dirPath,
			}
		}

		case "list_code_definition_names": {
			const dirPath = getStringField(parsedInput, "path") ?? ""
			return {
				tool: "listCodeDefinitionNames",
				path: dirPath,
			}
		}

		case "editor":
		case "replace_in_file": {
			const filePath = getStringField(parsedInput, "path") ?? ""
			const newText =
				getStringField(parsedInput, "new_text") ??
				getStringField(parsedInput, "new_str") ??
				getStringField(parsedInput, "content")
			const patch = getStringField(parsedInput, "patch") ?? getStringField(parsedInput, "diff")
			const oldText = getStringField(parsedInput, "old_text") ?? getStringField(parsedInput, "old_str")
			const isEdit = toolName === "replace_in_file" || !!oldText
			return {
				tool: isEdit ? "editedExistingFile" : "newFileCreated",
				path: filePath,
				content: newText,
				diff: patch,
			}
		}

		case "write_to_file": {
			const filePath = getStringField(parsedInput, "path") ?? ""
			const content = getStringField(parsedInput, "content") ?? getStringField(parsedInput, "new_text")
			return {
				tool: "newFileCreated",
				path: filePath,
				content,
			}
		}

		case "apply_patch": {
			const filePath = getStringField(parsedInput, "path") ?? ""
			const patch = getStringField(parsedInput, "patch")
			return {
				tool: "editedExistingFile",
				path: filePath,
				diff: patch,
			}
		}

		case "delete_file": {
			const filePath = getStringField(parsedInput, "path") ?? ""
			return {
				tool: "fileDeleted",
				path: filePath,
			}
		}

		case "search_codebase":
		case "search_files": {
			// The SDK's SearchCodebaseUnionInputSchema accepts multiple formats:
			//   1. { queries: string[] }  — standard object (parsedInput handles this)
			//   2. { queries: string }    — queries as single string
			//   3. string[]               — bare array (parseToolInput returns undefined for arrays)
			//   4. string                 — bare string (parseToolInput tries JSON.parse, returns undefined if not an object)
			// We must handle all four to avoid showing empty regex in the UI.
			let regex = ""
			if (parsedInput) {
				// Cases 1 & 2: input was an object with a "queries" field
				const queries = getArrayField(parsedInput, "queries")
				regex =
					queries?.join(", ") ?? getStringField(parsedInput, "queries") ?? getStringField(parsedInput, "regex") ?? ""
			} else if (Array.isArray(input)) {
				// Case 3: bare array of query strings
				regex = input.map(String).join(", ")
			} else if (typeof input === "string") {
				// Case 4: bare string query
				regex = input
			}
			const path = getStringField(parsedInput, "path")
			const filePattern = getStringField(parsedInput, "file_pattern") ?? getStringField(parsedInput, "filePattern")
			return {
				tool: "searchFiles",
				regex,
				path,
				filePattern,
			}
		}

		case "fetch_web_content":
		case "web_fetch": {
			// The SDK's fetch_web_content uses { requests: [{ url, prompt }] }
			// while the classic web_fetch uses { url, prompt } directly.
			let url = getStringField(parsedInput, "url") ?? ""
			if (!url && parsedInput) {
				const requests = parsedInput.requests
				if (Array.isArray(requests) && requests.length > 0) {
					const firstRequest = requests[0]
					if (typeof firstRequest === "object" && firstRequest !== null) {
						url = ((firstRequest as Record<string, unknown>).url as string) ?? ""
					}
				}
			}
			return {
				tool: "webFetch",
				path: url,
			}
		}

		case "web_search": {
			const query = getStringField(parsedInput, "query") ?? getStringField(parsedInput, "q") ?? ""
			return {
				tool: "webSearch",
				path: query,
			}
		}

		case "skills":
		case "use_skill": {
			// The SDK's skills tool uses { skill: "name", args?: "..." }
			// while the classic use_skill uses { skill_name: "name" }.
			const skillName =
				getStringField(parsedInput, "skill_name") ??
				getStringField(parsedInput, "skill") ??
				getStringField(parsedInput, "name") ??
				""
			return {
				tool: "useSkill",
				path: skillName,
			}
		}

		default: {
			// MCP tools and unknown tools — pass through with the raw tool name.
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

/** Extract file paths from a read_files/read_file input */
function extractFilePaths(input: Record<string, unknown> | undefined): string[] {
	if (!input) return []
	const files = input.files
	if (Array.isArray(files) && files.length > 0) {
		const paths = files
			.map((f) => {
				if (typeof f === "string") return f
				if (typeof f === "object" && f !== null) {
					return ((f as Record<string, unknown>).path as string) ?? ""
				}
				return ""
			})
			.filter(Boolean)
		if (paths.length > 0) {
			return paths
		}
	}
	const singlePath =
		(input.path as string) ?? (input.file_path as string) ?? (input.filePath as string) ?? (input.filename as string) ?? ""
	return singlePath ? [singlePath] : []
}

/** Extract the first file path from a read_files input */
function extractFirstFilePath(input: Record<string, unknown> | undefined): string {
	return extractFilePaths(input)[0] ?? ""
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

/** Get a boolean field from a parsed input object */
function getBooleanField(input: Record<string, unknown> | undefined, field: string): boolean | undefined {
	if (!input) return undefined
	const value = input[field]
	if (typeof value === "boolean") return value
	return undefined
}

/**
 * Extract raw text output from an SDK tool's output.
 *
 * The SDK's run_commands tool returns `ToolOperationResult[]` where each
 * result has `{ query, result, success, error? }`. The `result` field
 * contains the raw terminal output as a string. If the output is already
 * a string, it is returned as-is. If it's an array of ToolOperationResult
 * objects, extract and join the text from each result.
 */
export function extractToolOutputText(output: unknown): string {
	if (output == null) return ""
	if (typeof output === "string") return output

	// Handle ToolOperationResult[] from SDK tools (run_commands, search_codebase, etc.)
	if (Array.isArray(output)) {
		const parts: string[] = []
		for (const item of output) {
			if (typeof item === "string") {
				parts.push(item)
			} else if (typeof item === "object" && item !== null) {
				const record = item as Record<string, unknown>
				// ToolOperationResult has { query, result, success, error? }
				if ("result" in record && typeof record.result === "string" && record.result) {
					parts.push(record.result)
				} else if ("error" in record && typeof record.error === "string" && record.error) {
					parts.push(record.error)
				}
			}
		}
		if (parts.length > 0) {
			return parts.join("\n")
		}
	}

	// Fallback for unknown structured output
	return JSON.stringify(output)
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

					// attempt_completion is handled specially — it triggers
					// the green "Task Completed" rectangle in the webview.
					// In the classic extension, this was the ONLY way to show
					// the completion UI. We emit say:"completion_result" here
					// (partial) and ask:"completion_result" at content_end.
					if (toolName === "attempt_completion") {
						state.setAttemptCompletionSeen()
						const parsedInput = parseToolInput(input)
						const resultText = getStringField(parsedInput, "result") ?? ""
						messages.push({
							ts: state.getStreamingToolTs(),
							type: "say",
							say: "completion_result",
							text: resultText,
							partial: true,
						})
						break
					}

					// command tools use say="command" (not say="tool")
					// because the webview renders commands differently
					if (toolName === "run_commands" || toolName === "execute_command") {
						const parsedInput = parseToolInput(input)
						const commands = getArrayField(parsedInput, "commands")
						const commandText =
							commands?.join(" && ") ??
							getStringField(parsedInput, "commands") ??
							getStringField(parsedInput, "command") ??
							""
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

					// attempt_completion → emit ask:"completion_result" to
					// finalize the green "Task Completed" rectangle and enable
					// follow-up input. The say:"completion_result" was emitted
					// at content_start (partial); now we emit the ask version
					// which the webview uses to enable the follow-up textarea.
					if (toolName === "attempt_completion") {
						const storedInput = state.getStreamingToolInput()
						const ts = state.clearStreamingTool()
						const parsedInput = parseToolInput(storedInput)
						const resultText = getStringField(parsedInput, "result") ?? ""
						// Finalize the say:"completion_result" (non-partial)
						// This renders the green "Task Completed" rectangle.
						messages.push({
							ts,
							type: "say",
							say: "completion_result",
							text: resultText,
							partial: false,
						})
						// Emit ask:"completion_result" with EMPTY text to enable
						// follow-up input without rendering a second green rectangle.
						// The webview's ChatRow renders ask:"completion_result" with
						// empty text as an InvisibleSpacer, but still sets clineAsk
						// which enables the follow-up textarea.
						messages.push({
							ts: state.nextTs(),
							type: "ask",
							ask: "completion_result",
							text: "",
							partial: false,
						})
						break
					}

					// command tools finalize as say="command" with commandCompleted=true.
					// We keep the same timestamp to replace the streaming partial command row
					// in-place, so it doesn't disappear (command_output rows are filtered out
					// by combineCommandSequences in the chat pipeline).
					if (toolName === "run_commands" || toolName === "execute_command") {
						const storedInput = state.getStreamingToolInput()
						const parsedInput = parseToolInput(storedInput)
						const commands = getArrayField(parsedInput, "commands")
						const commandText =
							commands?.join(" && ") ??
							getStringField(parsedInput, "commands") ??
							getStringField(parsedInput, "command") ??
							""
						const outputStr = event.error ? `Error: ${event.error}` : extractToolOutputText(event.output)
						const ts = state.clearStreamingTool()
						messages.push({
							ts,
							type: "say",
							say: "command",
							text: outputStr ? `${commandText}\n${COMMAND_OUTPUT_STRING}\n${outputStr}` : commandText,
							partial: false,
							commandCompleted: true,
						})
						break
					}

					// All other tools → finalize the say="tool" message
					// Use the stored input from content_start since content_end
					// doesn't carry the input (S6-24 fix)
					const storedInput = state.getStreamingToolInput()
					const ts = state.clearStreamingTool()

					// Special handling: read_files may read multiple files in one tool call.
					// Emit one readFile UI message per file so the tool group summary and
					// list reflect what was actually read.
					if (toolName === "read_files" || toolName === "read_file") {
						const parsedInput = parseToolInput(storedInput)
						const filePaths = extractFilePaths(parsedInput)
						if (filePaths.length > 1) {
							filePaths.forEach((filePath, index) => {
								messages.push({
									ts: index === 0 ? ts : state.nextTs(),
									type: "say",
									say: "tool",
									text: JSON.stringify({ tool: "readFile", path: filePath } satisfies ClineSayTool),
									partial: false,
								})
							})
							break
						}
					}

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
				cacheWrites: (usageEvent.cacheWriteTokens as number) ?? undefined,
				cacheReads: (usageEvent.cacheReadTokens as number) ?? undefined,
				cost: (usageEvent.totalCost as number) ?? undefined,
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
			// Agent turn is complete. In the classic extension, the green
			// "Task Completed" rectangle was ONLY shown when the agent
			// explicitly called the attempt_completion tool. The done event
			// just signals the turn ended.
			//
			// If attempt_completion was already handled (via content_start/
			// content_end for that tool), we already emitted both
			// say:"completion_result" and ask:"completion_result" there.
			// We do NOT emit another completion_result here to avoid
			// duplicate green rectangles.
			//
			// If attempt_completion was NOT called (e.g., the agent just
			// responded with text), we still need to emit
			// ask:"completion_result" to enable the follow-up input in
			// the webview. But we emit it with empty text so the webview
			// renders an invisible spacer (no green rectangle) while still
			// setting clineAsk for follow-up messages.
			if (!state.wasAttemptCompletionSeen()) {
				messages.push({
					ts: state.nextTs(),
					type: "ask",
					ask: "completion_result",
					text: "",
					partial: false,
				})
			}
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
					cacheWrites: event.payload.event.cacheWriteTokens ?? 0,
					cacheReads: event.payload.event.cacheReadTokens ?? 0,
					totalCost: event.payload.event.totalCost ?? 0,
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
