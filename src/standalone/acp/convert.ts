import * as path from "node:path"
import type {
	SessionNotification,
	ToolCallContent,
	ToolCallLocation,
	ToolCallStatus,
	ToolCallUpdate,
	ToolKind,
} from "@agentclientprotocol/sdk"
import type { ClineAsk, ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"

export type AcpConversionState = {
	partialTextByKey: Map<string, string>
	partialMessageKeys: Set<string>
	toolCallIds: Map<string, string>
	lastCommandToolCallId?: string
	lastBrowserToolCallId?: string
}

export type ToolCallDetails = {
	toolCallId: string
	title: string
	kind?: ToolKind
	locations?: ToolCallLocation[]
	rawInput?: Record<string, unknown>
	contentText?: string
}

const PERMISSION_ASK_TYPES: Set<ClineAsk> = new Set(["tool", "command", "browser_action_launch", "use_mcp_server"])

const TOOL_KIND_BY_CLINE_TOOL: Record<string, ToolKind> = {
	readFile: "read",
	listFilesTopLevel: "search",
	listFilesRecursive: "search",
	listCodeDefinitionNames: "search",
	searchFiles: "search",
	webSearch: "search",
	webFetch: "fetch",
	editedExistingFile: "edit",
	newFileCreated: "edit",
	fileDeleted: "delete",
	summarizeTask: "think",
}

const TOOL_TITLE_BY_CLINE_TOOL: Record<string, string> = {
	readFile: "Read file",
	listFilesTopLevel: "List files",
	listFilesRecursive: "List files recursively",
	listCodeDefinitionNames: "List code definitions",
	searchFiles: "Search files",
	webSearch: "Search the web",
	webFetch: "Fetch URL",
	editedExistingFile: "Edit file",
	newFileCreated: "Create file",
	fileDeleted: "Delete file",
	summarizeTask: "Summarize task",
}

const ASK_FALLBACK_TEXT: Partial<Record<ClineAsk, string>> = {
	completion_result: "Task complete. Provide feedback or send the next prompt.",
	resume_task: "Provide input to resume this task.",
	resume_completed_task: "Provide input to resume this completed task.",
	plan_mode_respond: "Provide feedback on the plan to continue.",
	act_mode_respond: "Provide feedback to continue in act mode.",
	command_output: "Provide input for the running command.",
	mistake_limit_reached: "Cline needs guidance to continue. Provide next steps.",
	api_req_failed: "The request failed. Provide guidance to retry or adjust.",
	new_task: "Provide the next task.",
	condense: "Provide input to continue after condensing.",
	summarize_task: "Provide input to continue after summarizing.",
	report_bug: "Provide details to report the bug.",
}

export function createAcpConversionState(): AcpConversionState {
	return {
		partialTextByKey: new Map(),
		partialMessageKeys: new Set(),
		toolCallIds: new Map(),
	}
}

/**
 * Strips internal Cline metadata from text before sending to ACP clients.
 * This removes:
 * - <environment_details>...</environment_details> blocks
 * - <task>...</task> blocks
 * - # task_progress sections and related hints
 * - {"request":"..."} JSON wrappers from raw internal messages
 * - [tool_name for '...'] Result: patterns
 */
function sanitizeTextForAcp(text: string | undefined): string | undefined {
	if (!text) {
		return undefined
	}

	let result = text

	// Remove <environment_details>...</environment_details> blocks (handles multiline and escaped)
	result = result.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, "")
	result = result.replace(/<environment_details>[\s\S]*$/g, "") // Unclosed block at end

	// Remove <task>...</task> blocks
	result = result.replace(/<task>[\s\S]*?<\/task>/g, "")

	// Remove # task_progress sections (these are system-level hints)
	result = result.replace(/# task_progress[\s\S]*?(?=\n\n|\n#|$)/gi, "")
	result = result.replace(/# TODO LIST UPDATE REQUIRED[\s\S]*?(?=\n\n|\n#|$)/gi, "")

	// Remove {"request":"..."} JSON wrappers - match from {"request" to the next "}
	// This handles escaped newlines (\n) and quotes within the string
	result = result.replace(/\{"request":[^}]*\}/g, "")

	// Also handle the more complex case where the JSON spans with escaped content
	// Match {"request":"...any content including escaped chars..."} patterns
	result = result.replace(/\{[\s]*"request"[\s]*:[\s]*"(?:[^"\\]|\\.)*"\s*\}/g, "")

	// Remove [tool_name for '...'] Result: patterns
	result = result.replace(/\[[^\]]+\s+for\s+'[^']+'\]\s*Result:/g, "")

	// Remove "Loading..." status messages that are internal
	result = result.replace(/Loading\.\.\.$/gm, "")
	result = result.replace(/\nLoading\.\.\.$/, "")

	// Remove escaped newlines that shouldn't be there
	result = result.replace(/\\n/g, "\n")

	// Clean up excessive whitespace left behind
	result = result.replace(/\n{3,}/g, "\n\n").trim()

	return result || undefined
}

export function isPermissionAskType(ask?: ClineAsk): boolean {
	return ask ? PERMISSION_ASK_TYPES.has(ask) : false
}

export function messageKey(message: ClineMessage): string {
	return `${message.ts}:${message.type}:${message.say ?? ""}:${message.ask ?? ""}`
}

export function formatAskText(ask: ClineAsk | undefined, text: string | undefined): string | undefined {
	if (text && text.trim().length > 0) {
		return text
	}
	return ask ? ASK_FALLBACK_TEXT[ask] : undefined
}

export function parseToolPayload(text: string | undefined): ClineSayTool | undefined {
	if (!text) {
		return undefined
	}
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>
		if (parsed && typeof parsed === "object" && typeof parsed.tool === "string") {
			return parsed as unknown as ClineSayTool
		}
	} catch (_error) {
		return undefined
	}
	return undefined
}

function toolKindForToolName(tool?: string): ToolKind | undefined {
	if (!tool) {
		return undefined
	}
	return TOOL_KIND_BY_CLINE_TOOL[tool]
}

function toolTitleForPayload(payload: ClineSayTool | undefined): string | undefined {
	if (!payload) {
		return undefined
	}
	const baseTitle = TOOL_TITLE_BY_CLINE_TOOL[payload.tool] ?? payload.tool
	if (payload.path) {
		return `${baseTitle}: ${payload.path}`
	}
	if (payload.regex) {
		return `${baseTitle}: ${payload.regex}`
	}
	return baseTitle
}

function toolLocationsForPayload(payload: ClineSayTool | undefined): ToolCallLocation[] | undefined {
	if (!payload?.path) {
		return undefined
	}
	if (!path.isAbsolute(payload.path)) {
		return undefined
	}
	return [{ path: payload.path }]
}

function toolCallIdForMessage(state: AcpConversionState, message: ClineMessage, prefix: string): string {
	const key = messageKey(message)
	const existing = state.toolCallIds.get(key)
	if (existing) {
		return existing
	}
	const id = `${prefix}-${message.ts}`
	state.toolCallIds.set(key, id)
	return id
}

function contentBlocksForText(text?: string): ToolCallContent[] | undefined {
	if (!text) {
		return undefined
	}
	return [
		{
			type: "content",
			content: {
				type: "text",
				text,
			},
		},
	]
}

export function buildToolCallDetailsFromMessage(
	message: ClineMessage,
	state: AcpConversionState,
	options?: {
		toolCallPrefix?: string
		fallbackTitle?: string
	},
): ToolCallDetails | undefined {
	const prefix = options?.toolCallPrefix ?? "cline-tool"
	if (message.type === "say" && message.say === "command" && message.text) {
		const toolCallId = toolCallIdForMessage(state, message, prefix)
		state.lastCommandToolCallId = toolCallId
		return {
			toolCallId,
			title: `Run command: ${message.text}`,
			kind: "execute",
			rawInput: { command: message.text },
			contentText: message.text,
		}
	}

	if ((message.type === "say" && message.say === "tool") || (message.type === "ask" && message.ask === "tool")) {
		const payload = parseToolPayload(message.text)
		const toolCallId = toolCallIdForMessage(state, message, prefix)
		return {
			toolCallId,
			title: toolTitleForPayload(payload) ?? options?.fallbackTitle ?? "Tool request",
			kind: toolKindForToolName(payload?.tool),
			locations: toolLocationsForPayload(payload),
			rawInput: payload ? { ...payload } : undefined,
			contentText: payload ? JSON.stringify(payload, null, 2) : message.text,
		}
	}

	if (message.type === "say" && message.say === "browser_action") {
		const toolCallId = toolCallIdForMessage(state, message, prefix)
		state.lastBrowserToolCallId = toolCallId
		return {
			toolCallId,
			title: "Browser action",
			kind: "execute",
			contentText: message.text,
		}
	}

	if (message.type === "ask" && message.ask === "browser_action_launch") {
		const toolCallId = toolCallIdForMessage(state, message, prefix)
		return {
			toolCallId,
			title: "Launch browser action",
			kind: "execute",
			contentText: message.text,
		}
	}

	if (message.type === "ask" && message.ask === "use_mcp_server") {
		const toolCallId = toolCallIdForMessage(state, message, prefix)
		return {
			toolCallId,
			title: "Use MCP server",
			kind: "read",
			contentText: message.text,
		}
	}

	return undefined
}

export function buildNotificationsForMessage(
	message: ClineMessage,
	sessionId: string,
	state: AcpConversionState,
): SessionNotification[] {
	if (message.type === "ask") {
		if (isPermissionAskType(message.ask)) {
			return []
		}
		const askText = formatAskText(message.ask, message.text)
		const sanitizedAskText = sanitizeTextForAcp(askText)
		if (!sanitizedAskText) {
			return []
		}
		return [
			{
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: sanitizedAskText },
				},
			},
		]
	}

	if (message.type !== "say") {
		return []
	}

	switch (message.say) {
		case "reasoning": {
			const reasoningText = message.reasoning ?? message.text
			if (!reasoningText) {
				return []
			}
			return [
				{
					sessionId,
					update: {
						sessionUpdate: "agent_thought_chunk",
						content: { type: "text", text: reasoningText },
					},
				},
			]
		}
		case "command": {
			if (!message.text) {
				return []
			}
			const details = buildToolCallDetailsFromMessage(message, state, { toolCallPrefix: "cline-command" })
			if (!details) {
				return []
			}
			const status: ToolCallStatus = message.commandCompleted ? "completed" : "in_progress"
			return [buildToolCallNotification(sessionId, details, status)]
		}
		case "command_output": {
			if (state.lastCommandToolCallId && message.text) {
				return [
					{
						sessionId,
						update: {
							sessionUpdate: "tool_call_update",
							toolCallId: state.lastCommandToolCallId,
							status: "completed",
							content: contentBlocksForText(message.text),
						},
					},
				]
			}
			return buildTextNotification(sessionId, message.text)
		}
		case "tool": {
			const details = buildToolCallDetailsFromMessage(message, state, { toolCallPrefix: "cline-tool" })
			if (!details) {
				return buildTextNotification(sessionId, message.text)
			}
			const status: ToolCallStatus = message.partial ? "in_progress" : "completed"
			return [buildToolCallNotification(sessionId, details, status)]
		}
		case "browser_action": {
			const details = buildToolCallDetailsFromMessage(message, state, { toolCallPrefix: "cline-browser" })
			if (!details) {
				return buildTextNotification(sessionId, message.text)
			}
			return [buildToolCallNotification(sessionId, details, "completed")]
		}
		default: {
			return buildTextNotification(sessionId, message.text)
		}
	}
}

export function buildNotificationsForPartialMessage(
	message: ClineMessage,
	sessionId: string,
	state: AcpConversionState,
	isFinal: boolean,
): SessionNotification[] {
	if (message.type !== "say") {
		return []
	}
	if (message.say !== "text" && message.say !== "reasoning") {
		return []
	}

	const text = message.say === "reasoning" ? (message.reasoning ?? message.text) : message.text
	if (!text) {
		return []
	}

	const key = messageKey(message)
	const delta = extractDelta(state.partialTextByKey, key, text)
	state.partialMessageKeys.add(key)

	if (isFinal) {
		state.partialTextByKey.delete(key)
	}

	if (!delta) {
		return []
	}

	const sanitizedDelta = sanitizeTextForAcp(delta)
	if (!sanitizedDelta) {
		return []
	}

	const update: SessionNotification = {
		sessionId,
		update: {
			sessionUpdate: message.say === "reasoning" ? "agent_thought_chunk" : "agent_message_chunk",
			content: { type: "text", text: sanitizedDelta },
		},
	}

	return [update]
}

export function shouldSkipStateMessage(message: ClineMessage, state: AcpConversionState): boolean {
	if (message.partial) {
		return true
	}
	const key = messageKey(message)
	return state.partialMessageKeys.has(key)
}

function extractDelta(cache: Map<string, string>, key: string, text: string): string | undefined {
	const previous = cache.get(key) ?? ""
	if (text.startsWith(previous)) {
		const delta = text.slice(previous.length)
		cache.set(key, text)
		return delta || undefined
	}
	cache.set(key, text)
	return text
}

function buildTextNotification(sessionId: string, text?: string): SessionNotification[] {
	const sanitizedText = sanitizeTextForAcp(text)
	if (!sanitizedText) {
		return []
	}
	return [
		{
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: sanitizedText },
			},
		},
	]
}

function buildToolCallNotification(sessionId: string, details: ToolCallDetails, status: ToolCallStatus): SessionNotification {
	return {
		sessionId,
		update: {
			sessionUpdate: "tool_call",
			toolCallId: details.toolCallId,
			title: details.title,
			kind: details.kind,
			status,
			rawInput: details.rawInput,
			locations: details.locations,
			content: contentBlocksForText(details.contentText),
		},
	}
}

export function buildPermissionToolCall(details: ToolCallDetails): ToolCallUpdate {
	return {
		toolCallId: details.toolCallId,
		title: details.title,
		kind: details.kind,
		status: "pending",
		rawInput: details.rawInput,
		locations: details.locations,
		content: contentBlocksForText(details.contentText),
	}
}

export function resolveClineModeId(mode: string | undefined): "plan" | "act" {
	return mode === "act" ? "act" : "plan"
}

export function buildModeState(currentMode: string | undefined) {
	return {
		currentModeId: resolveClineModeId(currentMode),
		availableModes: [
			{
				id: "plan",
				name: "Plan",
				description: "Plan and ask for confirmation before edits",
			},
			{
				id: "act",
				name: "Act",
				description: "Execute changes and tools when approved",
			},
		],
	}
}
