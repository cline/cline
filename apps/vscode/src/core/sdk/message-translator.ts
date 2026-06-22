// Translates SDK CoreSessionEvents into ClineMessage[] for webview consumption.
//
// Distilled from the deleted apps/vscode/src/sdk/message-translator.ts. The webview expects
// ClineMessage objects with ask/say types; this maps the SDK's structured agent events
// (content_start/content_update/content_end for text|reasoning|tool, usage, done, error) plus
// top-level session events (chunk, ended) to that format, stamping every message with
// ts/seq/epoch/partial from the shared MessageIdMinter.
//
// Key mappings:
// - content_start/update (text)      -> say:"text"   partial=true  (uses accumulated text)
// - content_end          (text)      -> say:"text"   partial=false
// - content_start        (reasoning) -> say:"reasoning" partial=true (accumulated)
// - content_end          (reasoning) -> say:"reasoning" partial=false
// - content_start        (tool)      -> say:"tool" | "command" | "use_mcp_server" partial=true
// - content_end          (tool)      -> finalized non-partial + (command/mcp) output rows
// - iteration_start                  -> say:"api_req_started" (opens request row)
// - usage                            -> say:"api_req_started" with ClineApiReqInfo
// - error                            -> say:"api_req_started"(streamingFailed) + ask:"api_req_failed"
// - done                             -> no transcript row (turn outcome lives in TurnState)
// - ended                            -> resets streaming state

import type { CoreSessionEvent } from "@cline/core"
import type { AgentEvent } from "@cline/shared"
import { COMMAND_OUTPUT_STRING } from "@shared/combineCommandSequences"
import type { ClineApiReqInfo, ClineMessage, ClineSay, ClineSayTool } from "@shared/ExtensionMessage"
import type { MessageIdMinter } from "./message-id-minter"

function normalizeUsage(event: {
	inputTokens?: number
	outputTokens?: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	cost?: number
	totalCost?: number
}): ClineApiReqInfo {
	const inputTokens = event.inputTokens ?? 0
	const cacheReads = event.cacheReadTokens ?? 0
	const cacheWrites = event.cacheWriteTokens ?? 0
	// SDK reports inputTokens inclusive of cache; the webview wants disjoint buckets.
	const tokensIn = Math.max(0, inputTokens - cacheReads - cacheWrites)
	return {
		tokensIn,
		tokensOut: event.outputTokens ?? 0,
		cacheWrites,
		cacheReads,
		cost: event.cost ?? event.totalCost ?? 0,
	}
}

// ---------------------------------------------------------------------------
// SDK tool name -> classic ClineSayTool mapping
// ---------------------------------------------------------------------------

function parseToolInput(input: unknown): Record<string, unknown> | undefined {
	if (!input) {
		return undefined
	}
	if (typeof input === "object" && !Array.isArray(input)) {
		return input as Record<string, unknown>
	}
	if (typeof input === "string") {
		try {
			const parsed = JSON.parse(input)
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>
			}
		} catch {
			// not JSON
		}
	}
	return undefined
}

function getString(input: Record<string, unknown> | undefined, field: string): string | undefined {
	const value = input?.[field]
	return typeof value === "string" ? value : undefined
}

function getBoolean(input: Record<string, unknown> | undefined, field: string): boolean | undefined {
	const value = input?.[field]
	return typeof value === "boolean" ? value : undefined
}

function extractFilePaths(input: Record<string, unknown> | undefined): string[] {
	if (!input) {
		return []
	}
	const files = input.files
	if (Array.isArray(files) && files.length > 0) {
		const paths = files
			.map((f) => (typeof f === "string" ? f : typeof f === "object" && f !== null ? ((f as Record<string, unknown>).path as string) : ""))
			.filter(Boolean)
		if (paths.length > 0) {
			return paths
		}
	}
	const single = getString(input, "path") ?? getString(input, "file_path") ?? getString(input, "filePath")
	return single ? [single] : []
}

function extractCommandText(input: unknown): string {
	if (Array.isArray(input)) {
		return (input as string[]).join(" && ")
	}
	if (typeof input === "string") {
		return input
	}
	const parsed = parseToolInput(input)
	const commands = parsed?.commands
	if (Array.isArray(commands)) {
		return commands.map(String).join(" && ")
	}
	return getString(parsed, "commands") ?? getString(parsed, "command") ?? ""
}

export function extractToolOutputText(output: unknown): string {
	if (output == null) {
		return ""
	}
	if (typeof output === "string") {
		return output
	}
	if (Array.isArray(output)) {
		const parts: string[] = []
		for (const item of output) {
			if (typeof item === "string") {
				parts.push(item)
			} else if (typeof item === "object" && item !== null) {
				const record = item as Record<string, unknown>
				if (typeof record.result === "string" && record.result) {
					parts.push(record.result)
				} else if (typeof record.error === "string" && record.error) {
					parts.push(record.error)
				}
			}
		}
		if (parts.length > 0) {
			return parts.join("\n")
		}
	}
	return JSON.stringify(output)
}

function sdkToolToClineSayTool(toolName: string, input?: unknown): ClineSayTool {
	const parsed = parseToolInput(input)
	switch (toolName) {
		case "read_files":
		case "read_file":
			return { tool: "readFile", path: extractFilePaths(parsed)[0] ?? "" }
		case "list_files": {
			const recursive = getBoolean(parsed, "recursive") ?? false
			return { tool: recursive ? "listFilesRecursive" : "listFilesTopLevel", path: getString(parsed, "path") ?? "" }
		}
		case "list_code_definition_names":
			return { tool: "listCodeDefinitionNames", path: getString(parsed, "path") ?? "" }
		case "editor":
		case "replace_in_file": {
			const path = getString(parsed, "path") ?? ""
			const newText = getString(parsed, "new_text") ?? getString(parsed, "new_str") ?? getString(parsed, "content")
			const oldText = getString(parsed, "old_text") ?? getString(parsed, "old_str")
			const patch = getString(parsed, "patch") ?? getString(parsed, "diff")
			const isEdit = toolName === "replace_in_file" || !!oldText
			const content = oldText && newText ? `------- SEARCH\n${oldText}\n=======\n${newText}\n+++++++ REPLACE` : newText
			return { tool: isEdit ? "editedExistingFile" : "newFileCreated", path, content, diff: patch }
		}
		case "write_to_file":
			return {
				tool: "newFileCreated",
				path: getString(parsed, "path") ?? "",
				content: getString(parsed, "content") ?? getString(parsed, "new_text"),
			}
		case "apply_patch": {
			const patch = getString(parsed, "patch") ?? getString(parsed, "diff") ?? getString(parsed, "input")
			return { tool: "editedExistingFile", path: getString(parsed, "path") ?? "", content: patch, diff: patch }
		}
		case "delete_file":
			return { tool: "fileDeleted", path: getString(parsed, "path") ?? "" }
		case "search_codebase":
		case "search_files": {
			let regex = ""
			const queries = parsed?.queries
			if (Array.isArray(queries)) {
				regex = queries.map(String).join(", ")
			} else if (typeof queries === "string") {
				regex = queries
			} else if (typeof input === "string") {
				regex = input
			} else {
				regex = getString(parsed, "regex") ?? ""
			}
			return {
				tool: "searchFiles",
				regex,
				path: getString(parsed, "path"),
				filePattern: getString(parsed, "file_pattern") ?? getString(parsed, "filePattern"),
			}
		}
		case "fetch_web_content":
		case "web_fetch":
			return { tool: "webFetch", path: getString(parsed, "url") ?? "" }
		case "web_search":
			return { tool: "webSearch", path: getString(parsed, "query") ?? getString(parsed, "q") ?? "" }
		case "skills":
		case "use_skill":
			return { tool: "useSkill", path: getString(parsed, "skill_name") ?? getString(parsed, "skill") ?? "" }
		default:
			return {
				tool: toolName as ClineSayTool["tool"],
				path: getString(parsed, "path") ?? getString(parsed, "url") ?? getString(parsed, "command") ?? "",
			}
	}
}

function isCompletionTool(toolName: string): boolean {
	return toolName === "submit_and_exit" || toolName === "attempt_completion"
}

function getCompletionResultText(input: unknown): string {
	const parsed = parseToolInput(input)
	return getString(parsed, "summary") ?? getString(parsed, "result") ?? ""
}

function parseMcpToolName(toolName: string): { serverName: string; toolName: string } | undefined {
	const idx = toolName.indexOf("__")
	if (idx <= 0) {
		return undefined
	}
	const serverName = toolName.substring(0, idx)
	const mcpToolName = toolName.substring(idx + 2)
	return mcpToolName ? { serverName, toolName: mcpToolName } : undefined
}

function buildMcpPayload(info: { serverName: string; toolName: string }, input?: unknown): string {
	const parsed = parseToolInput(input)
	let argumentsStr: string | undefined
	if (parsed && Object.keys(parsed).length > 0) {
		argumentsStr = JSON.stringify(parsed, null, 2)
	} else if (typeof input === "string" && input.trim()) {
		argumentsStr = input
	}
	return JSON.stringify({ type: "use_mcp_tool", serverName: info.serverName, toolName: info.toolName, arguments: argumentsStr })
}

/**
 * Build the approval ask ClineMessage for a tool, matching the webview's specialized rows
 * (MCP, command, generic tool). Used by the Controller when servicing requestToolApproval.
 */
export function buildToolApprovalAskMessage(toolName: string, input: unknown): { ask: ClineMessage["ask"]; text: string } {
	const mcpInfo = parseMcpToolName(toolName)
	if (mcpInfo) {
		return { ask: "use_mcp_server", text: buildMcpPayload(mcpInfo, input) }
	}
	if (toolName === "run_commands" || toolName === "execute_command") {
		return { ask: "command", text: extractCommandText(input) }
	}
	return { ask: "tool", text: JSON.stringify(sdkToolToClineSayTool(toolName, input)) }
}

// ---------------------------------------------------------------------------
// MessageTranslator
// ---------------------------------------------------------------------------

/**
 * Stateful translator. One instance per Controller; it tracks the open partial streams (text,
 * reasoning, tool) so updates reuse the same ts and the webview merges them in place. ts/seq/
 * epoch all come from the shared MessageIdMinter so ids never collide across generators.
 */
export class MessageTranslator {
	private streamingTextTs?: number
	private streamingReasoningTs?: number
	private streamingReasoningText = ""
	private streamingToolTs?: number
	private streamingToolInput?: unknown
	private streamingToolName?: string

	constructor(private readonly minter: MessageIdMinter) {}

	/** Reset per-iteration streaming pointers (open text/reasoning/tool). */
	reset(): void {
		this.streamingTextTs = undefined
		this.streamingReasoningTs = undefined
		this.streamingReasoningText = ""
		this.streamingToolTs = undefined
		this.streamingToolInput = undefined
		this.streamingToolName = undefined
	}

	/** Stamp seq + epoch on a freshly-built message. ts is set by the caller. */
	private stamp(message: ClineMessage): ClineMessage {
		message.seq = this.minter.nextSeq()
		message.epoch = this.minter.currentEpoch()
		return message
	}

	/**
	 * Translate one CoreSessionEvent into zero or more stamped ClineMessages. The Controller
	 * appends these to its clineMessages[] and pushes them to the webview.
	 */
	translate(event: CoreSessionEvent): ClineMessage[] {
		switch (event.type) {
			case "chunk":
				// Raw model output — never shown directly; the structured agent_event path renders it.
				return []
			case "agent_event":
				return this.translateAgentEvent(event.payload.event)
			case "ended":
				this.reset()
				return []
			default:
				return []
		}
	}

	private translateAgentEvent(event: AgentEvent): ClineMessage[] {
		const messages: ClineMessage[] = []
		switch (event.type) {
			case "content_start":
			case "content_update": {
				this.handleContentStart(event, messages)
				break
			}
			case "content_end": {
				this.handleContentEnd(event, messages)
				break
			}
			case "iteration_start": {
				this.reset()
				messages.push(
					this.stamp({
						ts: this.minter.nextTs(),
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({} satisfies ClineApiReqInfo),
						partial: false,
					}),
				)
				break
			}
			case "usage": {
				messages.push(
					this.stamp({
						ts: this.minter.nextTs(),
						type: "say",
						say: "api_req_started",
						text: JSON.stringify(normalizeUsage(event)),
						partial: false,
					}),
				)
				break
			}
			case "notice": {
				messages.push(
					this.stamp({
						ts: this.minter.nextTs(),
						type: "say",
						say: "info",
						text: event.message ?? "",
						partial: false,
					}),
				)
				break
			}
			case "error": {
				const text = this.serializeError(event.error)
				messages.push(
					this.stamp({
						ts: this.minter.nextTs(),
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({ streamingFailedMessage: text } satisfies ClineApiReqInfo),
						partial: false,
					}),
				)
				messages.push(
					this.stamp({
						ts: this.minter.nextTs(),
						type: "ask",
						ask: "api_req_failed",
						text,
						partial: false,
					}),
				)
				break
			}
			case "done":
			case "iteration_end":
				break
			default:
				break
		}
		return messages
	}

	private handleContentStart(
		event: Extract<AgentEvent, { type: "content_start" | "content_update" }>,
		messages: ClineMessage[],
	): void {
		switch (event.contentType) {
			case "text": {
				if (this.streamingTextTs === undefined) {
					this.streamingTextTs = this.minter.nextTs()
				}
				messages.push(
					this.stamp({
						ts: this.streamingTextTs,
						type: "say",
						say: "text",
						text: event.accumulated ?? event.text ?? "",
						partial: true,
					}),
				)
				break
			}
			case "reasoning": {
				if (this.streamingReasoningTs === undefined) {
					this.streamingReasoningTs = this.minter.nextTs()
				}
				this.streamingReasoningText += event.reasoning ?? ""
				messages.push(
					this.stamp({
						ts: this.streamingReasoningTs,
						type: "say",
						say: "reasoning",
						text: this.streamingReasoningText,
						reasoning: this.streamingReasoningText,
						partial: true,
					}),
				)
				break
			}
			case "tool": {
				if (event.type === "content_update") {
					// Non-spawn tool updates are ignored; the partial start row suffices until end.
					break
				}
				this.handleToolStart(event)
				const toolName = event.toolName ?? "unknown"
				if (toolName === "ask_question" || toolName === "ask_followup_question") {
					break
				}
				if (isCompletionTool(toolName)) {
					messages.push(
						this.stamp({
							ts: this.getStreamingToolTs(),
							type: "say",
							say: "completion_result",
							text: getCompletionResultText(event.input),
							partial: true,
						}),
					)
					break
				}
				if (toolName === "run_commands" || toolName === "execute_command") {
					messages.push(
						this.stamp({
							ts: this.getStreamingToolTs(),
							type: "say",
							say: "command",
							text: `${extractCommandText(event.input)}\n${COMMAND_OUTPUT_STRING}`,
							partial: true,
						}),
					)
					break
				}
				const mcpInfo = parseMcpToolName(toolName)
				if (mcpInfo) {
					messages.push(
						this.stamp({
							ts: this.getStreamingToolTs(),
							type: "say",
							say: "use_mcp_server" as ClineSay,
							text: buildMcpPayload(mcpInfo, event.input),
							partial: true,
						}),
					)
					break
				}
				messages.push(
					this.stamp({
						ts: this.getStreamingToolTs(),
						type: "say",
						say: "tool",
						text: JSON.stringify(sdkToolToClineSayTool(toolName, event.input)),
						partial: true,
					}),
				)
				break
			}
		}
	}

	private handleContentEnd(event: Extract<AgentEvent, { type: "content_end" }>, messages: ClineMessage[]): void {
		switch (event.contentType) {
			case "text": {
				const ts = this.streamingTextTs ?? this.minter.nextTs()
				this.streamingTextTs = undefined
				messages.push(this.stamp({ ts, type: "say", say: "text", text: event.text ?? "", partial: false }))
				break
			}
			case "reasoning": {
				const ts = this.streamingReasoningTs ?? this.minter.nextTs()
				this.streamingReasoningTs = undefined
				this.streamingReasoningText = ""
				const reasoning = event.reasoning ?? ""
				messages.push(this.stamp({ ts, type: "say", say: "reasoning", text: reasoning, reasoning, partial: false }))
				break
			}
			case "tool": {
				const toolName = event.toolName ?? "unknown"
				if (toolName === "ask_question" || toolName === "ask_followup_question") {
					break
				}
				if (isCompletionTool(toolName)) {
					const completionInput = this.streamingToolInput
					const ts = this.clearStreamingTool()
					messages.push(
						this.stamp({
							ts,
							type: "say",
							say: "completion_result",
							text: getCompletionResultText(completionInput),
							partial: false,
						}),
					)
					break
				}
				if (toolName === "run_commands" || toolName === "execute_command") {
					const commandInput = this.streamingToolInput
					const command = extractCommandText(commandInput)
					const output = event.error ? `Error: ${event.error}` : extractToolOutputText(event.output)
					const ts = this.clearStreamingTool()
					messages.push(
						this.stamp({
							ts,
							type: "say",
							say: "command",
							text: output ? `${command}\n${COMMAND_OUTPUT_STRING}\n${output}` : command,
							partial: false,
							commandCompleted: true,
						}),
					)
					break
				}
				const mcpInfo = parseMcpToolName(toolName)
				if (mcpInfo) {
					const input = this.streamingToolInput
					const ts = this.clearStreamingTool()
					messages.push(
						this.stamp({
							ts,
							type: "say",
							say: "use_mcp_server" as ClineSay,
							text: buildMcpPayload(mcpInfo, input),
							partial: false,
						}),
					)
					const output = event.error ? `Error: ${event.error}` : extractToolOutputText(event.output)
					if (output) {
						messages.push(
							this.stamp({
								ts: this.minter.nextTs(),
								type: "say",
								say: "mcp_server_response" as ClineSay,
								text: output,
								partial: false,
							}),
						)
					}
					break
				}
				const storedInput = this.streamingToolInput
				const ts = this.clearStreamingTool()
				if (toolName === "read_files" || toolName === "read_file") {
					const paths = extractFilePaths(parseToolInput(storedInput))
					if (paths.length > 1) {
						paths.forEach((path, index) => {
							messages.push(
								this.stamp({
									ts: index === 0 ? ts : this.minter.nextTs(),
									type: "say",
									say: "tool",
									text: JSON.stringify({ tool: "readFile", path } satisfies ClineSayTool),
									partial: false,
								}),
							)
						})
						break
					}
				}
				messages.push(
					this.stamp({
						ts,
						type: "say",
						say: "tool",
						text: JSON.stringify(sdkToolToClineSayTool(toolName, storedInput)),
						partial: false,
					}),
				)
				if (event.error) {
					messages.push(
						this.stamp({ ts: this.minter.nextTs(), type: "say", say: "error", text: event.error, partial: false }),
					)
				}
				break
			}
		}
	}

	private handleToolStart(event: Extract<AgentEvent, { type: "content_start" }>): void {
		this.streamingToolName = event.toolName
		this.streamingToolInput = event.input
	}

	private getStreamingToolTs(): number {
		if (this.streamingToolTs === undefined) {
			this.streamingToolTs = this.minter.nextTs()
		}
		return this.streamingToolTs
	}

	private clearStreamingTool(): number {
		const ts = this.streamingToolTs ?? this.minter.nextTs()
		this.streamingToolTs = undefined
		this.streamingToolName = undefined
		this.streamingToolInput = undefined
		return ts
	}

	private serializeError(error: unknown): string {
		if (error && typeof error === "object" && "message" in error) {
			return String((error as { message?: unknown }).message ?? "Unknown error")
		}
		return typeof error === "string" ? error : "Unknown error"
	}
}
