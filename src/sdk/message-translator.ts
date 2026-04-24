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
// - SDK "agent_event" content_start (tool: MCP) → ClineMessage say="use_mcp_server" with partial=true
//   MCP tools use serverName__toolName naming convention. The webview renders
//   MCP tool calls via say/ask="use_mcp_server" with ClineAskUseMcpServer JSON.
// - SDK "agent_event" content_end (tool: MCP) → say="use_mcp_server" + say="mcp_server_response"
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
import type {
	ClineApiReqInfo,
	ClineAskUseMcpServer,
	ClineAskUseSubagents,
	ClineMessage,
	ClineSay,
	ClineSaySubagentStatus,
	ClineSayTool,
	ClineSubagentUsageInfo,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
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
	/** Whether a tool call ended with an error (content_end with event.error) */
	toolError?: boolean
	/** Whether a tool call ended successfully (content_end without error) */
	toolSuccess?: boolean
	/** Usage info if available */
	usage?: {
		tokensIn: number
		tokensOut: number
		cacheWrites?: number
		cacheReads?: number
		totalCost?: number
	}
}

type NormalizedUsage = NonNullable<TranslationResult["usage"]>

function normalizeUsageEvent(usageEvent: {
	inputTokens?: number
	outputTokens?: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	cost?: number
	totalCost?: number
}): NormalizedUsage {
	const inputTokens = usageEvent.inputTokens ?? 0
	const cacheReads = usageEvent.cacheReadTokens ?? 0
	const cacheWrites = usageEvent.cacheWriteTokens ?? 0

	// SDK provider usage reports inputTokens as the full request size, with
	// cache reads/writes included. Classic Cline/webview metrics expect
	// tokensIn, cacheReads, and cacheWrites to be disjoint buckets.
	const uncachedInputTokens = Math.max(0, inputTokens - cacheReads - cacheWrites)

	return {
		tokensIn: uncachedInputTokens,
		tokensOut: usageEvent.outputTokens ?? 0,
		cacheWrites,
		cacheReads,
		totalCost: usageEvent.cost ?? usageEvent.totalCost ?? 0,
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

	// -----------------------------------------------------------------------
	// spawn_agent tracking — aggregates parallel spawn_agent tool calls into
	// the rich SubagentStatusRow UI (use_subagents + subagent messages).
	// -----------------------------------------------------------------------

	/** Active spawn_agent entries keyed by toolCallId */
	private spawnAgentEntries = new Map<string, SubagentStatusItem>()
	/** Stable timestamp for the combined say:"use_subagents" prompts message */
	private spawnAgentPromptsTs: number | undefined
	/** Stable timestamp for the combined say:"subagent" status message */
	private spawnAgentStatusTs: number | undefined
	/** Counter for assigning index to new spawn_agent entries */
	private spawnAgentNextIndex = 0

	/** Register a new spawn_agent call. Returns the entry for this call. */
	addSpawnAgent(toolCallId: string, prompt: string): SubagentStatusItem {
		const entry: SubagentStatusItem = {
			index: ++this.spawnAgentNextIndex,
			prompt,
			status: "running",
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
		}
		this.spawnAgentEntries.set(toolCallId, entry)
		return entry
	}

	/** Get a spawn_agent entry by toolCallId */
	getSpawnAgent(toolCallId: string): SubagentStatusItem | undefined {
		return this.spawnAgentEntries.get(toolCallId)
	}

	/** Whether there are any active spawn_agent calls */
	hasSpawnAgents(): boolean {
		return this.spawnAgentEntries.size > 0
	}

	/** Get all spawn_agent entries as an ordered array */
	getSpawnAgentItems(): SubagentStatusItem[] {
		return Array.from(this.spawnAgentEntries.values()).sort((a, b) => a.index - b.index)
	}

	/** Get or create the stable timestamp for say:"use_subagents" prompts messages */
	getSpawnAgentPromptsTs(): number {
		if (!this.spawnAgentPromptsTs) {
			this.spawnAgentPromptsTs = this.nextTs()
		}
		return this.spawnAgentPromptsTs
	}

	/** Get or create the stable timestamp for subagent status messages */
	getSpawnAgentStatusTs(): number {
		if (!this.spawnAgentStatusTs) {
			this.spawnAgentStatusTs = this.nextTs()
		}
		return this.spawnAgentStatusTs
	}

	/** Build a ClineSaySubagentStatus from the current entries */
	buildSubagentStatus(overallStatus: ClineSaySubagentStatus["status"]): ClineSaySubagentStatus {
		const items = this.getSpawnAgentItems()
		const completed = items.filter((e) => e.status === "completed" || e.status === "failed").length
		const successes = items.filter((e) => e.status === "completed").length
		const failures = items.filter((e) => e.status === "failed").length
		return {
			status: overallStatus,
			total: items.length,
			completed,
			successes,
			failures,
			toolCalls: items.reduce((acc, e) => acc + (e.toolCalls || 0), 0),
			inputTokens: items.reduce((acc, e) => acc + (e.inputTokens || 0), 0),
			outputTokens: items.reduce((acc, e) => acc + (e.outputTokens || 0), 0),
			contextWindow: items.reduce((acc, e) => Math.max(acc, e.contextWindow || 0), 0),
			maxContextTokens: items.reduce((acc, e) => Math.max(acc, e.contextTokens || 0), 0),
			maxContextUsagePercentage: items.reduce((acc, e) => Math.max(acc, e.contextUsagePercentage || 0), 0),
			items,
		}
	}

	/** Clear all spawn_agent state (called at iteration_start) */
	clearSpawnAgents(): void {
		this.spawnAgentEntries.clear()
		this.spawnAgentPromptsTs = undefined
		this.spawnAgentStatusTs = undefined
		this.spawnAgentNextIndex = 0
	}

	/** Reset all streaming state (new turn) */
	reset(): void {
		this.streamingTextTs = undefined
		this.streamingReasoningTs = undefined
		this.streamingToolTs = undefined
		this.streamingToolInput = undefined
		this.streamingToolName = undefined
		this.attemptCompletionSeen = false
		this.clearSpawnAgents()
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
 *   ask_question/ask_followup_question → (not a visual tool — handled by askQuestion executor in SdkController)
 *   MCP tools (serverName__toolName)   → (handled before reaching sdkToolToClineSayTool — emitted as say="use_mcp_server")
 */
export function sdkToolToClineSayTool(toolName: string, input?: unknown): ClineSayTool {
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

			// When the SDK provides both old and new text, build a search/replace
			// diff in the format DiffEditRow expects. ChatRow passes `content` to
			// DiffEditRow's `patch` prop, so the formatted diff must go into `content`.
			const diffContent = oldText && newText ? `------- SEARCH\n${oldText}\n=======\n${newText}\n+++++++ REPLACE` : newText

			return {
				tool: isEdit ? "editedExistingFile" : "newFileCreated",
				path: filePath,
				content: diffContent,
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
			// The SDK sends apply_patch input as { input: 'apply_patch <<"EOF"\n*** Begin Patch\n...' }
			// Also check the "patch" and "diff" fields for compatibility.
			const patch =
				getStringField(parsedInput, "patch") ??
				getStringField(parsedInput, "diff") ??
				getStringField(parsedInput, "input")
			return {
				tool: "editedExistingFile",
				path: filePath,
				// ChatRow passes `content` to DiffEditRow's `patch` prop,
				// so we must populate `content` for the diff to render.
				content: patch,
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
// MCP tool detection
// ---------------------------------------------------------------------------

/**
 * MCP tools created by `createMcpTools()` use `serverName__toolName` format
 * (double underscore separator). This function detects MCP tools and parses
 * the server name and tool name.
 *
 * Returns undefined if the tool name doesn't match the MCP naming convention.
 */
function parseMcpToolName(toolName: string): { serverName: string; toolName: string } | undefined {
	const separatorIndex = toolName.indexOf("__")
	if (separatorIndex <= 0) return undefined
	const serverName = toolName.substring(0, separatorIndex)
	const mcpToolName = toolName.substring(separatorIndex + 2)
	if (!mcpToolName) return undefined
	return { serverName, toolName: mcpToolName }
}

/**
 * Build a ClineAskUseMcpServer JSON payload for MCP tool calls.
 * This is what the webview's ChatRow expects when rendering MCP tool calls
 * (message.ask === "use_mcp_server" or message.say === "use_mcp_server").
 */
function buildMcpToolPayload(mcpInfo: { serverName: string; toolName: string }, input?: unknown): string {
	const parsedInput = parseToolInput(input)
	// Format arguments as a JSON string (matching classic ClineAskUseMcpServer.arguments)
	let argumentsStr: string | undefined
	if (parsedInput && Object.keys(parsedInput).length > 0) {
		argumentsStr = JSON.stringify(parsedInput, null, 2)
	} else if (typeof input === "string" && input.trim()) {
		argumentsStr = input
	}

	return JSON.stringify({
		type: "use_mcp_tool",
		serverName: mcpInfo.serverName,
		toolName: mcpInfo.toolName,
		arguments: argumentsStr,
	} satisfies ClineAskUseMcpServer)
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
						// Handle multiple input formats from SDK run_commands:
						//   1. { commands: string[] }  — standard wrapped object
						//   2. string[]                — bare array (parseToolInput returns undefined)
						//   3. { command: string }     — single command as object (execute_command compat)
						//   4. string                  — bare string
						let commandText = ""
						if (Array.isArray(input)) {
							// Case 2: bare array of command strings
							commandText = (input as string[]).join(" && ")
						} else if (typeof input === "string") {
							// Case 4: bare string command
							commandText = input
						} else {
							const parsedInput = parseToolInput(input)
							const commands = getArrayField(parsedInput, "commands")
							commandText =
								commands?.join(" && ") ??
								getStringField(parsedInput, "commands") ??
								getStringField(parsedInput, "command") ??
								""
						}
						messages.push({
							ts: state.getStreamingToolTs(),
							type: "say",
							say: "command",
							text: commandText,
							partial: true,
						})
						break
					}
					// spawn_agent → rich subagent UI (SubagentStatusRow)
					// Emit say:"use_subagents" with prompts list, then say:"subagent"
					// with running status. Multiple parallel spawn_agent calls in the
					// same iteration are aggregated into a single status message.
					if (toolName === "spawn_agent") {
						const parsedInput = parseToolInput(input)
						const taskPrompt = getStringField(parsedInput, "task") ?? ""
						const callId = event.toolCallId ?? `spawn-${state.nextTs()}`
						state.addSpawnAgent(callId, taskPrompt)

						// Emit the combined prompts list (replaces itself on each new spawn_agent)
						const allPrompts = state.getSpawnAgentItems().map((e) => e.prompt)
						const approvalPayload: ClineAskUseSubagents = { prompts: allPrompts }
						messages.push({
							ts: state.getSpawnAgentPromptsTs(),
							type: "say",
							say: "use_subagents" as ClineSay,
							text: JSON.stringify(approvalPayload),
							partial: true,
						})

						// Clear the generic streaming tool so it doesn't also emit say:"tool"
						state.clearStreamingTool()
						break
					}

					// MCP tools use serverName__toolName naming convention.
					// The webview renders MCP tool calls via say/ask="use_mcp_server"
					// with ClineAskUseMcpServer JSON, not generic say="tool".
					const mcpInfo = parseMcpToolName(toolName)
					if (mcpInfo) {
						const mcpPayload = buildMcpToolPayload(mcpInfo, input)
						messages.push({
							ts: state.getStreamingToolTs(),
							type: "say",
							say: "use_mcp_server" as ClineSay,
							text: mcpPayload,
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
			// spawn_agent progress updates → emit say:"subagent" with live stats.
			// The SDK's spawn_agent tool may emit content_update events with
			// sub-agent progress (iterations, tool calls, usage). We translate
			// these into the ClineSaySubagentStatus format for the rich UI.
			const updateToolName = event.toolName ?? state.getStreamingToolName()
			if (updateToolName === "spawn_agent" && state.hasSpawnAgents()) {
				const callId = event.toolCallId ?? ""
				const entry = callId ? state.getSpawnAgent(callId) : undefined
				if (entry) {
					// Apply progress from the update payload if available
					const updateData = event.update as Record<string, unknown> | undefined
					if (updateData) {
						if (typeof updateData.toolCalls === "number") entry.toolCalls = updateData.toolCalls
						if (typeof updateData.inputTokens === "number") entry.inputTokens = updateData.inputTokens
						if (typeof updateData.outputTokens === "number") entry.outputTokens = updateData.outputTokens
						if (typeof updateData.totalCost === "number") entry.totalCost = updateData.totalCost
						if (typeof updateData.contextTokens === "number") entry.contextTokens = updateData.contextTokens
						if (typeof updateData.contextWindow === "number") entry.contextWindow = updateData.contextWindow
						if (typeof updateData.contextUsagePercentage === "number")
							entry.contextUsagePercentage = updateData.contextUsagePercentage
						if (typeof updateData.latestToolCall === "string") entry.latestToolCall = updateData.latestToolCall
					}
				}
				// Emit a running status update
				const status = state.buildSubagentStatus("running")
				messages.push({
					ts: state.getSpawnAgentStatusTs(),
					type: "say",
					say: "subagent" as ClineSay,
					text: JSON.stringify(status),
					partial: true,
				})
				break
			}

			// For all other tools, content_update is ignored — the
			// content_start message with partial=true is sufficient until
			// content_end finalizes it.
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

					// spawn_agent → finalize the subagent entry and emit
					// say:"subagent" (completed/failed) + say:"subagent_usage".
					// When all spawn_agent calls in this iteration finish, the
					// final say:"subagent" has partial=false.
					if (toolName === "spawn_agent") {
						const callId = event.toolCallId ?? ""
						const entry = callId ? state.getSpawnAgent(callId) : undefined
						if (entry) {
							// Extract output stats from SpawnAgentOutput
							const output = event.output as Record<string, unknown> | undefined
							if (output) {
								entry.result = typeof output.text === "string" ? output.text : undefined
								const usage = output.usage as Record<string, unknown> | undefined
								if (usage) {
									if (typeof usage.inputTokens === "number") entry.inputTokens = usage.inputTokens
									if (typeof usage.outputTokens === "number") entry.outputTokens = usage.outputTokens
								}
							}
							if (event.error) {
								entry.status = "failed"
								entry.error = event.error
							} else {
								entry.status = "completed"
							}
						}

						// Determine overall status — all done when every entry is completed/failed
						const items = state.getSpawnAgentItems()
						const allDone = items.every((e) => e.status === "completed" || e.status === "failed")
						const hasFailed = items.some((e) => e.status === "failed")
						const overallStatus: ClineSaySubagentStatus["status"] = allDone
							? hasFailed
								? "failed"
								: "completed"
							: "running"

						const status = state.buildSubagentStatus(overallStatus)
						messages.push({
							ts: state.getSpawnAgentStatusTs(),
							type: "say",
							say: "subagent" as ClineSay,
							text: JSON.stringify(status),
							partial: !allDone,
						})

						// When all done, emit subagent_usage for cost accounting
						if (allDone) {
							const usagePayload: ClineSubagentUsageInfo = {
								source: "subagents",
								tokensIn: items.reduce((acc, e) => acc + (e.inputTokens || 0), 0),
								tokensOut: items.reduce((acc, e) => acc + (e.outputTokens || 0), 0),
								cacheWrites: 0,
								cacheReads: 0,
								cost: items.reduce((acc, e) => acc + (e.totalCost || 0), 0),
							}
							messages.push({
								ts: state.nextTs(),
								type: "say",
								say: "subagent_usage" as ClineSay,
								text: JSON.stringify(usagePayload),
								partial: false,
							})
						}

						// Don't clear the generic streaming tool — spawn_agent
						// didn't use it (we cleared it at content_start)
						break
					}

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
						// Handle multiple input formats (same as content_start):
						//   1. { commands: string[] }  — standard wrapped object
						//   2. string[]                — bare array (parseToolInput returns undefined)
						//   3. { command: string }     — single command as object (execute_command compat)
						//   4. string                  — bare string
						let commandText = ""
						if (Array.isArray(storedInput)) {
							commandText = (storedInput as string[]).join(" && ")
						} else if (typeof storedInput === "string") {
							commandText = storedInput
						} else {
							const parsedInput = parseToolInput(storedInput)
							const commands = getArrayField(parsedInput, "commands")
							commandText =
								commands?.join(" && ") ??
								getStringField(parsedInput, "commands") ??
								getStringField(parsedInput, "command") ??
								""
						}
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

					// MCP tools → finalize as say="use_mcp_server" + say="mcp_server_response"
					// The classic extension emits:
					//   1. say/ask: "use_mcp_server" (tool call display with args)
					//   2. say: "mcp_server_request_started" (spinner)
					//   3. say: "mcp_server_response" (tool output)
					// In the SDK path, by content_end the tool has already executed,
					// so we emit the finalized tool call + response together.
					const mcpInfoEnd = parseMcpToolName(toolName)
					if (mcpInfoEnd) {
						const storedMcpInput = state.getStreamingToolInput()
						const mcpTs = state.clearStreamingTool()
						const mcpPayload = buildMcpToolPayload(mcpInfoEnd, storedMcpInput)

						// Finalize the use_mcp_server message (non-partial)
						messages.push({
							ts: mcpTs,
							type: "say",
							say: "use_mcp_server" as ClineSay,
							text: mcpPayload,
							partial: false,
						})

						// Emit the MCP server response with the tool output
						const mcpOutputStr = event.error ? `Error: ${event.error}` : extractToolOutputText(event.output)
						if (mcpOutputStr) {
							messages.push({
								ts: state.nextTs(),
								type: "say",
								say: "mcp_server_response" as ClineSay,
								text: mcpOutputStr,
								partial: false,
							})
						}
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
			const usageEvent = normalizeUsageEvent(event)
			const apiReqInfo: ClineApiReqInfo = {
				tokensIn: usageEvent.tokensIn,
				tokensOut: usageEvent.tokensOut,
				cacheWrites: usageEvent.cacheWrites,
				cacheReads: usageEvent.cacheReads,
				cost: usageEvent.totalCost,
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
			// Sub-agent events (parentAgentId is set) should NOT produce
			// ClineMessages in the main chat. The sub-agent's work is
			// represented by the parent's spawn_agent tool events
			// (content_start/update/end) which we translate into the rich
			// SubagentStatusRow UI. Without this filter, every sub-agent
			// tool call, text output, iteration, and usage event would
			// flood the main chat.
			const agentEvent = event.payload.event
			if (agentEvent.parentAgentId) {
				break
			}

			// Agent events contain structured content (text, reasoning, tools)
			const agentMessages = translateAgentEvent(agentEvent, state)
			result.messages.push(...agentMessages)

			// Check for done/error events
			if (agentEvent.type === "done") {
				result.turnComplete = true
			}
			if (agentEvent.type === "error") {
				result.turnComplete = true
			}

			// Track tool success/error for consecutive mistake counting.
			// A content_end event with contentType "tool" signals a completed
			// tool call — if event.error is set, the tool failed.
			if (agentEvent.type === "content_end" && agentEvent.contentType === "tool") {
				if (agentEvent.error) {
					result.toolError = true
				} else {
					result.toolSuccess = true
				}
			}

			// Extract usage from usage events
			if (agentEvent.type === "usage") {
				result.usage = normalizeUsageEvent(agentEvent)
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
