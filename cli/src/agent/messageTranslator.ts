/**
 * Message translator for converting Cline messages to ACP session updates.
 *
 * This module handles the translation between Cline's internal message format
 * (ClineMessage) and the ACP protocol's session update format. A single Cline
 * message may produce multiple ACP updates.
 *
 * @module acp/messageTranslator
 */

import type * as acp from "@agentclientprotocol/sdk"
import type { ClineMessage, ClineSayBrowserAction, ClineSayTool } from "@shared/ExtensionMessage"
import type { AcpSessionState, TranslatedMessage } from "./types.js"

/**
 * Maps Cline tool types to ACP ToolKind values.
 */
const TOOL_KIND_MAP: Record<string, acp.ToolKind> = {
	// File operations
	editedExistingFile: "edit",
	newFileCreated: "edit",
	fileDeleted: "delete",
	readFile: "read",
	listFilesTopLevel: "read",
	listFilesRecursive: "read",
	listCodeDefinitionNames: "read",
	searchFiles: "search",
	// Web operations
	webFetch: "fetch",
	webSearch: "search",
	// Other
	summarizeTask: "think",
	useSkill: "other",
}

/**
 * Maps browser actions to ACP ToolKind values.
 */
const BROWSER_ACTION_KIND_MAP: Record<string, acp.ToolKind> = {
	launch: "execute",
	click: "execute",
	type: "execute",
	scroll_down: "execute",
	scroll_up: "execute",
	close: "execute",
}

/**
 * Generate a unique tool call ID.
 */
function generateToolCallId(): string {
	return crypto.randomUUID()
}

/**
 * Result of parsing a unified diff.
 */
interface ParsedDiff {
	oldText: string
	newText: string
}

/**
 * Parse a unified diff format to extract old and new text.
 *
 * Unified diff format:
 * --- a/file.txt
 * +++ b/file.txt
 * @@ -1,3 +1,4 @@
 *  unchanged line
 * -removed line
 * +added line
 *  another unchanged line
 *
 * @param unifiedDiff - The unified diff string
 * @returns The parsed old and new text
 */
function parseUnifiedDiff(unifiedDiff: string): ParsedDiff {
	const lines = unifiedDiff.split("\n")
	const oldLines: string[] = []
	const newLines: string[] = []

	let inHunk = false

	for (const line of lines) {
		// Skip diff headers
		if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ")) {
			continue
		}

		// Detect hunk header
		if (line.startsWith("@@")) {
			inHunk = true
			continue
		}

		if (!inHunk) {
			continue
		}

		if (line.startsWith("-")) {
			// Line was removed (exists in old, not in new)
			oldLines.push(line.substring(1))
		} else if (line.startsWith("+")) {
			// Line was added (exists in new, not in old)
			newLines.push(line.substring(1))
		} else if (line.startsWith(" ") || line === "") {
			// Context line (exists in both) - remove the leading space
			const content = line.startsWith(" ") ? line.substring(1) : line
			oldLines.push(content)
			newLines.push(content)
		} else if (line.startsWith("\\")) {
		} else {
			// Unknown line format, treat as context
			oldLines.push(line)
			newLines.push(line)
		}
	}

	return {
		oldText: oldLines.join("\n"),
		newText: newLines.join("\n"),
	}
}

/**
 * Options for translating a message.
 */
export interface TranslateMessageOptions {
	/**
	 * An existing toolCallId to use for tool messages.
	 * If provided, updates will be sent as tool_call_update instead of new tool_call.
	 * This is used when updating a streaming tool call that was already created.
	 */
	existingToolCallId?: string
}

/**
 * Translate a single Cline message to ACP session updates.
 *
 * @param message - The Cline message to translate
 * @param sessionState - The current session state for tracking tool calls
 * @param options - Optional translation options (e.g., existing toolCallId for updates)
 * @returns The translated message with ACP updates and permission requirements
 */
export function translateMessage(
	message: ClineMessage,
	sessionState: AcpSessionState,
	options?: TranslateMessageOptions,
): TranslatedMessage {
	const updates: acp.SessionUpdate[] = []
	let requiresPermission = false
	let permissionRequest: TranslatedMessage["permissionRequest"]
	let toolCallId: string | undefined

	if (message.type === "say" && message.say) {
		const sayResult = translateSayMessage(message, sessionState, options)
		updates.push(...sayResult.updates)
		toolCallId = sayResult.toolCallId
	} else if (message.type === "ask" && message.ask) {
		const askResult = translateAskMessage(message, sessionState, options)
		updates.push(...askResult.updates)
		requiresPermission = askResult.requiresPermission ?? false
		permissionRequest = askResult.permissionRequest
		toolCallId = askResult.toolCallId
	}

	return {
		updates,
		requiresPermission,
		permissionRequest,
		toolCallId,
	}
}

/**
 * Translate a "say" type Cline message to ACP updates.
 */
function translateSayMessage(
	message: ClineMessage,
	sessionState: AcpSessionState,
	_options?: TranslateMessageOptions,
): TranslatedMessage {
	const updates: acp.SessionUpdate[] = []
	let toolCallId: string | undefined
	const say = message.say!

	switch (say) {
		case "text":
			// Text messages → agent_message_chunk
			if (message.text) {
				updates.push({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: message.text },
				})
			}
			break

		case "user_feedback":
		case "user_feedback_diff":
			// User feedback messages - don't echo the user's input back to them
			// The ACP client already displays what the user typed
			break

		case "reasoning":
			// Reasoning/thinking → agent_thought_chunk
			if (message.reasoning || message.text) {
				updates.push({
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: message.reasoning || message.text || "" },
				})
			}
			break

		case "tool":
			// Tool execution → tool_call with status updates
			updates.push(...translateToolMessage(message, sessionState))
			break

		case "command":
			// Command execution → tool_call (kind: execute)
			updates.push(...translateCommandMessage(message, sessionState))
			break

		case "command_output":
			// Command output → tool_call_update with terminal content
			updates.push(...translateCommandOutputMessage(message, sessionState))
			break

		case "completion_result":
			// Task completion - no direct update needed, handled by stopReason in prompt response
			// But we can send a final message chunk with a leading newline to separate from previous content
			if (message.text) {
				updates.push({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "\n" + message.text },
				})
			}
			break

		case "error":
		case "error_retry":
		case "diff_error":
		case "clineignore_error":
			// Error messages → agent_message_chunk (errors are displayed as text)
			if (message.text) {
				updates.push({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: `Error: ${message.text}` },
				})
			}
			// Also update the current tool call if there is one
			if (sessionState.currentToolCallId) {
				updates.push({
					sessionUpdate: "tool_call_update",
					toolCallId: sessionState.currentToolCallId,
					status: "failed",
					rawOutput: { error: message.text },
				})
				sessionState.currentToolCallId = undefined
			}
			break

		case "browser_action_launch":
		case "browser_action":
			// Browser actions → tool_call (kind: execute)
			updates.push(...translateBrowserActionMessage(message, sessionState))
			break

		case "browser_action_result":
			// Browser action result → tool_call_update
			if (sessionState.currentToolCallId) {
				const result = message.text ? JSON.parse(message.text) : {}
				updates.push({
					sessionUpdate: "tool_call_update",
					toolCallId: sessionState.currentToolCallId,
					status: "completed",
					rawOutput: result,
				})
				sessionState.currentToolCallId = undefined
			}
			break

		case "mcp_server_request_started":
		case "use_mcp_server":
			// MCP server operations → tool_call
			updates.push(...translateMcpMessage(message, sessionState))
			break

		case "mcp_server_response":
			// MCP response → tool_call_update
			if (sessionState.currentToolCallId) {
				updates.push({
					sessionUpdate: "tool_call_update",
					toolCallId: sessionState.currentToolCallId,
					status: "completed",
					rawOutput: message.text ? JSON.parse(message.text) : undefined,
				})
				sessionState.currentToolCallId = undefined
			}
			break

		case "api_req_started":
			// API request started - could be shown as agent thinking
			// updates.push({
			// 	sessionUpdate: "agent_thought_chunk",
			// 	content: { type: "text", text: "Making API Request" },
			// })
			break

		case "api_req_finished":
			// API request finished - no specific update needed
			break

		case "task":
			// Task started - don't echo the user's prompt back to them
			// The ACP client already knows what they typed
			break

		case "task_progress":
			// Task progress → plan update
			updates.push(...translateTaskProgressMessage(message))
			break

		case "hook_status":
			// Format hook status as a human-readable message
			if (message.text) {
				try {
					const hookInfo = JSON.parse(message.text) as { hookName: string; status: string; toolName?: string }
					const target = hookInfo.toolName ? ` for ${hookInfo.toolName}` : ""
					let statusText: string
					switch (hookInfo.status) {
						case "running":
							statusText = `Running ${hookInfo.hookName} hook${target}...`
							break
						case "completed":
							statusText = `${hookInfo.hookName} hook completed`
							break
						case "cancelled":
							statusText = `${hookInfo.hookName} hook cancelled`
							break
						default:
							statusText = `${hookInfo.hookName} hook: ${hookInfo.status}`
					}
					updates.push({
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: statusText },
					})
				} catch {
					// If parsing fails, skip the message rather than showing raw JSON
				}
			}
			break

		case "hook_output_stream":
			// Suppress hook output streams in ACP mode - these are debug details
			// that clutter the conversation. The hook_status message provides
			// sufficient user-facing feedback.
			break

		case "info":
		case "shell_integration_warning":
		case "shell_integration_warning_with_suggestion":
		case "checkpoint_created":
		case "load_mcp_documentation":
		case "mcp_notification":
		case "deleted_api_reqs":
		case "api_req_retried":
		case "command_permission_denied":
		case "generate_explanation":
		case "conditional_rules_applied":
			// Informational messages - optionally shown as agent messages
			if (message.text) {
				updates.push({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: message.text },
				})
			}
			break
	}

	return { updates, toolCallId }
}

/**
 * Translate a "ask" type Cline message to ACP updates.
 * Ask messages typically require permission from the client.
 */
function translateAskMessage(
	message: ClineMessage,
	sessionState: AcpSessionState,
	options?: TranslateMessageOptions,
): TranslatedMessage {
	const updates: acp.SessionUpdate[] = []
	const ask = message.ask!
	let requiresPermission = false
	let permissionRequest: TranslatedMessage["permissionRequest"]
	let toolCallId: string | undefined

	switch (ask) {
		case "followup":
		case "plan_mode_respond":
			// These are questions to the user - send as agent message and await next prompt
			if (message.text) {
				let textToSend = message.text

				// Try to parse JSON and extract the response/question field
				// plan_mode_respond uses { response: string, options?: string[] }
				// followup uses { question: string, options?: string[] }
				try {
					const parsed = JSON.parse(message.text)
					if (ask === "plan_mode_respond" && parsed.response !== undefined) {
						textToSend = parsed.response
					} else if (ask === "followup" && parsed.question !== undefined) {
						textToSend = parsed.question
					}
				} catch {
					// If parsing fails, use the raw text
				}

				if (textToSend) {
					updates.push({
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: textToSend },
					})
				}
			}
			break

		case "act_mode_respond":
			// act_mode_respond signals the turn is complete but its text content was already
			// sent via the say: "text" message. Don't send it again to avoid duplicate output.
			break

		case "command":
			// Command permission request → tool_call + request_permission
			{
				const toolCallId = generateToolCallId()
				sessionState.currentToolCallId = toolCallId

				const toolCall: acp.ToolCall = {
					toolCallId,
					title: `Execute command: ${extractCommandFromText(message.text)}`,
					kind: "execute",
					status: "pending",
					rawInput: { command: extractCommandFromText(message.text) },
				}

				updates.push({
					sessionUpdate: "tool_call",
					...toolCall,
				})

				sessionState.pendingToolCalls.set(toolCallId, toolCall)
				requiresPermission = true
				permissionRequest = {
					toolCall,
					options: [
						{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
						{ kind: "allow_always", optionId: "allow_always", name: "Always Allow" },
						{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
					],
				}
			}
			break

		case "tool":
			// Tool permission request → tool_call + request_permission
			{
				const toolInfo = message.text ? parseToolInfo(message.text) : null
				const isUpdate = !!options?.existingToolCallId

				// Reuse existing toolCallId if this is an update to a streaming tool call
				toolCallId = options?.existingToolCallId || generateToolCallId()
				sessionState.currentToolCallId = toolCallId

				if (isUpdate) {
					// This is an update to an existing streaming tool call - send tool_call_update
					updates.push({
						sessionUpdate: "tool_call_update",
						toolCallId,
						status: "pending",
						rawInput: toolInfo?.input,
						content: toolInfo?.path
							? [
									{
										type: "content",
										content: { type: "text", text: toolInfo.path },
									},
								]
							: undefined,
					})
					// Don't require permission again for updates - only for final non-partial message
					// Permission will be requested when partial=false
					if (!message.partial) {
						const existingToolCall = sessionState.pendingToolCalls.get(toolCallId)
						if (existingToolCall) {
							// Update the existing tool call with latest info
							existingToolCall.rawInput = toolInfo?.input
							existingToolCall.locations = toolInfo?.path ? [{ path: toolInfo.path }] : undefined
							existingToolCall.title = toolInfo?.title || existingToolCall.title
							requiresPermission = true
							permissionRequest = {
								toolCall: existingToolCall,
								options: [
									{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
									{ kind: "allow_always", optionId: "allow_always", name: "Always Allow" },
									{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
								],
							}
						}
					}
				} else {
					// This is a new tool call
					const toolCall: acp.ToolCall = {
						toolCallId,
						title: toolInfo?.title || "Tool operation",
						kind: toolInfo?.kind || "other",
						status: "pending",
						rawInput: toolInfo?.input,
						locations: toolInfo?.path ? [{ path: toolInfo.path }] : undefined,
					}

					updates.push({
						sessionUpdate: "tool_call",
						...toolCall,
					})

					sessionState.pendingToolCalls.set(toolCallId, toolCall)

					// Only request permission for non-partial messages (complete tool calls)
					if (!message.partial) {
						requiresPermission = true
						permissionRequest = {
							toolCall,
							options: [
								{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
								{ kind: "allow_always", optionId: "allow_always", name: "Always Allow" },
								{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
							],
						}
					}
				}
			}
			break

		case "browser_action_launch":
			// Browser launch permission
			{
				const toolCallId = generateToolCallId()
				sessionState.currentToolCallId = toolCallId

				const toolCall: acp.ToolCall = {
					toolCallId,
					title: "Launch browser",
					kind: "execute",
					status: "pending",
					rawInput: { url: message.text },
				}

				updates.push({
					sessionUpdate: "tool_call",
					...toolCall,
				})

				sessionState.pendingToolCalls.set(toolCallId, toolCall)
				requiresPermission = true
				permissionRequest = {
					toolCall,
					options: [
						{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
						{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
					],
				}
			}
			break

		case "use_mcp_server":
			// MCP server usage permission
			{
				let mcpInfo: Record<string, unknown> = {}
				try {
					mcpInfo = message.text ? JSON.parse(message.text) : {}
				} catch {
					// If JSON parsing fails, use empty object
				}
				const toolCallId = generateToolCallId()
				sessionState.currentToolCallId = toolCallId

				const toolCall: acp.ToolCall = {
					toolCallId,
					title: `Use MCP server: ${mcpInfo.serverName || "unknown"}`,
					kind: "execute",
					status: "pending",
					rawInput: mcpInfo,
				}

				updates.push({
					sessionUpdate: "tool_call",
					...toolCall,
				})

				sessionState.pendingToolCalls.set(toolCallId, toolCall)
				requiresPermission = true
				permissionRequest = {
					toolCall,
					options: [
						{ kind: "allow_once", optionId: "allow_once", name: "Allow Once" },
						{ kind: "allow_always", optionId: "allow_always", name: "Always Allow" },
						{ kind: "reject_once", optionId: "reject_once", name: "Reject" },
					],
				}
			}
			break

		case "completion_result":
			// Completion result needs a leading newline to separate from previous content
			if (message.text) {
				updates.push({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "\n" + message.text },
				})
			}
			break
		case "resume_task":
		case "resume_completed_task":
		case "new_task":
		case "condense":
		case "summarize_task":
		case "report_bug":
		case "api_req_failed":
		case "mistake_limit_reached":
		case "command_output":
			// These are typically handled internally or shown as messages
			if (message.text) {
				updates.push({
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: message.text },
				})
			}
			break
	}

	return { updates, requiresPermission, permissionRequest, toolCallId }
}

/**
 * Translate a tool message to ACP tool_call updates.
 */
function translateToolMessage(message: ClineMessage, sessionState: AcpSessionState): acp.SessionUpdate[] {
	const updates: acp.SessionUpdate[] = []

	if (!message.text) return updates

	try {
		const toolInfo = JSON.parse(message.text) as ClineSayTool
		const toolCallId = sessionState.currentToolCallId || generateToolCallId()

		// Determine tool kind
		const kind = TOOL_KIND_MAP[toolInfo.tool] || "other"

		// Determine status based on message state
		const status: acp.ToolCallStatus = message.partial ? "in_progress" : "completed"

		// Build title
		const title = buildToolTitle(toolInfo)

		// Build content
		const content: acp.ToolCallContent[] = []
		if (toolInfo.content) {
			content.push({
				type: "content",
				content: { type: "text", text: toolInfo.content },
			})
		}
		if (toolInfo.diff) {
			// Parse the unified diff to extract old and new text
			const parsedDiff = parseUnifiedDiff(toolInfo.diff)
			content.push({
				type: "diff",
				path: toolInfo.path || "",
				oldText: parsedDiff.oldText,
				newText: parsedDiff.newText,
			})
		}

		// Build locations
		const locations: acp.ToolCallLocation[] = []
		if (toolInfo.path) {
			locations.push({ path: toolInfo.path })
		}

		if (!sessionState.currentToolCallId) {
			// New tool call
			sessionState.currentToolCallId = toolCallId
			updates.push({
				sessionUpdate: "tool_call",
				toolCallId,
				title,
				kind,
				status,
				rawInput: toolInfo,
				content: content.length > 0 ? content : undefined,
				locations: locations.length > 0 ? locations : undefined,
			})
		} else {
			// Update existing tool call
			updates.push({
				sessionUpdate: "tool_call_update",
				toolCallId,
				status,
				rawOutput: toolInfo,
				content: content.length > 0 ? content : undefined,
			})
		}

		// Clear current tool call ID if completed
		if (status === "completed") {
			sessionState.currentToolCallId = undefined
		}
	} catch {
		// If parsing fails, treat as plain text
		updates.push({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: message.text },
		})
	}

	return updates
}

/**
 * Translate a command message to ACP tool_call.
 */
function translateCommandMessage(message: ClineMessage, sessionState: AcpSessionState): acp.SessionUpdate[] {
	const updates: acp.SessionUpdate[] = []

	const command = extractCommandFromText(message.text)
	const toolCallId = generateToolCallId()
	sessionState.currentToolCallId = toolCallId

	updates.push({
		sessionUpdate: "tool_call",
		toolCallId,
		title: `Execute: ${command.substring(0, 50)}${command.length > 50 ? "..." : ""}`,
		kind: "execute",
		status: message.partial ? "in_progress" : "completed",
		rawInput: { command },
		// Use text content to display the command being executed
		content: [
			{
				type: "content",
				content: { type: "text", text: `$ ${command}` },
			},
		],
	})

	return updates
}

/**
 * Translate command output to ACP tool_call_update.
 */
function translateCommandOutputMessage(message: ClineMessage, sessionState: AcpSessionState): acp.SessionUpdate[] {
	const updates: acp.SessionUpdate[] = []

	if (sessionState.currentToolCallId) {
		const status: acp.ToolCallStatus = message.commandCompleted ? "completed" : "in_progress"

		updates.push({
			sessionUpdate: "tool_call_update",
			toolCallId: sessionState.currentToolCallId,
			status,
			// Store output in rawOutput and optionally as text content
			rawOutput: message.text ? { output: message.text } : undefined,
			content: message.text
				? [
						{
							type: "content",
							content: { type: "text", text: message.text },
						},
					]
				: undefined,
		})

		if (message.commandCompleted) {
			sessionState.currentToolCallId = undefined
		}
	} else {
		// No active tool call, show as message
		if (message.text) {
			updates.push({
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: `Output:\n${message.text}` },
			})
		}
	}

	return updates
}

/**
 * Translate browser action to ACP tool_call.
 */
function translateBrowserActionMessage(message: ClineMessage, sessionState: AcpSessionState): acp.SessionUpdate[] {
	const updates: acp.SessionUpdate[] = []

	try {
		const action = message.text ? (JSON.parse(message.text) as ClineSayBrowserAction) : null
		const toolCallId = sessionState.currentToolCallId || generateToolCallId()

		if (!sessionState.currentToolCallId) {
			sessionState.currentToolCallId = toolCallId
		}

		const title = action ? `Browser: ${action.action}` : "Browser action"
		const kind = action ? BROWSER_ACTION_KIND_MAP[action.action] || "execute" : "execute"

		updates.push({
			sessionUpdate: "tool_call",
			toolCallId,
			title,
			kind,
			status: message.partial ? "in_progress" : "completed",
			rawInput: action,
		})
	} catch {
		updates.push({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: message.text || "Browser action" },
		})
	}

	return updates
}

/**
 * Translate MCP server message to ACP tool_call.
 */
function translateMcpMessage(message: ClineMessage, sessionState: AcpSessionState): acp.SessionUpdate[] {
	const updates: acp.SessionUpdate[] = []

	try {
		const mcpInfo = message.text ? JSON.parse(message.text) : {}
		const toolCallId = sessionState.currentToolCallId || generateToolCallId()

		if (!sessionState.currentToolCallId) {
			sessionState.currentToolCallId = toolCallId
		}

		updates.push({
			sessionUpdate: "tool_call",
			toolCallId,
			title: `MCP: ${mcpInfo.serverName || "server"} - ${mcpInfo.toolName || mcpInfo.type || "operation"}`,
			kind: "execute",
			status: message.partial ? "in_progress" : "completed",
			rawInput: mcpInfo,
		})
	} catch {
		updates.push({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: message.text || "MCP operation" },
		})
	}

	return updates
}

/**
 * Translate task progress (focus chain/todos) to ACP plan update.
 */
function translateTaskProgressMessage(message: ClineMessage): acp.SessionUpdate[] {
	const updates: acp.SessionUpdate[] = []

	if (!message.text) return updates

	// Parse the markdown checklist format
	const entries = parseTaskProgressToEntries(message.text)

	if (entries.length > 0) {
		updates.push({
			sessionUpdate: "plan",
			entries,
		})
	}

	return updates
}

/**
 * Parse markdown checklist format into ACP plan entries.
 *
 * Example input:
 * - [x] Completed task
 * - [ ] Pending task
 * - Currently working on this
 */
function parseTaskProgressToEntries(text: string): acp.PlanEntry[] {
	const entries: acp.PlanEntry[] = []
	const lines = text.split("\n")

	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) continue

		// Match markdown checklist items
		const checkboxMatch = trimmed.match(/^-\s*\[([ xX])\]\s*(.+)$/)
		if (checkboxMatch) {
			const isCompleted = checkboxMatch[1].toLowerCase() === "x"
			const content = checkboxMatch[2].trim()

			entries.push({
				content,
				status: isCompleted ? "completed" : "pending",
				priority: "medium",
			})
			continue
		}

		// Match plain list items (treated as in_progress or pending)
		const listMatch = trimmed.match(/^-\s+(.+)$/)
		if (listMatch) {
			entries.push({
				content: listMatch[1].trim(),
				status: "in_progress",
				priority: "medium",
			})
		}
	}

	return entries
}

/**
 * Build a human-readable title for a tool operation.
 */
function buildToolTitle(toolInfo: ClineSayTool): string {
	switch (toolInfo.tool) {
		case "editedExistingFile":
			return `Edit file: ${toolInfo.path || "unknown"}`
		case "newFileCreated":
			return `Create file: ${toolInfo.path || "unknown"}`
		case "fileDeleted":
			return `Delete file: ${toolInfo.path || "unknown"}`
		case "readFile":
			return `Read file: ${toolInfo.path || "unknown"}`
		case "listFilesTopLevel":
			return `List files: ${toolInfo.path || "."}`
		case "listFilesRecursive":
			return `List files (recursive): ${toolInfo.path || "."}`
		case "listCodeDefinitionNames":
			return `List definitions: ${toolInfo.path || "unknown"}`
		case "searchFiles":
			return `Search: ${toolInfo.regex || "pattern"}`
		case "webFetch":
			return "Fetch web content"
		case "webSearch":
			return "Web search"
		case "summarizeTask":
			return "Summarize task"
		case "useSkill":
			return "Use skill"
		default:
			return `Tool: ${toolInfo.tool}`
	}
}

/**
 * Extract command text from a message.
 */
function extractCommandFromText(text?: string): string {
	if (!text) return ""
	// Remove any surrounding whitespace and potential formatting
	return text.trim()
}

/**
 * Parse tool info from message text.
 */
function parseToolInfo(text: string): { title: string; kind: acp.ToolKind; path?: string; input?: unknown } | null {
	try {
		const info = JSON.parse(text) as ClineSayTool
		return {
			title: buildToolTitle(info),
			kind: TOOL_KIND_MAP[info.tool] || "other",
			path: info.path,
			input: info,
		}
	} catch {
		return null
	}
}

/**
 * Translate multiple Cline messages to ACP session updates.
 *
 * @param messages - Array of Cline messages to translate
 * @param sessionState - The current session state
 * @returns Combined array of ACP session updates
 */
export function translateMessages(messages: ClineMessage[], sessionState: AcpSessionState): acp.SessionUpdate[] {
	const allUpdates: acp.SessionUpdate[] = []

	for (const message of messages) {
		const result = translateMessage(message, sessionState)
		allUpdates.push(...result.updates)
	}

	return allUpdates
}

/**
 * Create an initial session state for tracking tool calls.
 */
export function createSessionState(sessionId: string): AcpSessionState {
	return {
		sessionId,
		isProcessing: false,
		cancelled: false,
		pendingToolCalls: new Map(),
	}
}
