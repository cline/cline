import { ClineDefaultTool, getToolUseNames } from "@shared/tools"
import { nanoid } from "nanoid"
import type { AssistantMessageContent, TextStreamContent, ToolUse } from "."
import { type ToolParamName, toolParamNames } from "./tool-param-names"

interface ParsedJsonTool {
	name: string
	args: Record<string, unknown>
}

interface JsonToolSpan {
	tools: ParsedJsonTool[]
	start: number
	end: number
}

const ALLOWED_PARAM_NAMES = new Set<ToolParamName>(toolParamNames)

function getAllowedToolNames(): Set<string> {
	return new Set(getToolUseNames())
}

function parseArgsField(field: unknown): Record<string, unknown> {
	if (field === null || field === undefined) {
		return {}
	}
	if (typeof field === "string") {
		try {
			const parsed: unknown = JSON.parse(field)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>
			}
		} catch {
			return {}
		}
		return {}
	}
	if (typeof field === "object" && !Array.isArray(field)) {
		return field as Record<string, unknown>
	}
	return {}
}

function normalizeFunctionShape(fn: Record<string, unknown>, allowedNames: Set<string>): ParsedJsonTool | undefined {
	const name = typeof fn.name === "string" ? fn.name : undefined
	if (!name || !allowedNames.has(name)) {
		return undefined
	}
	const args = parseArgsField(fn.arguments ?? fn.parameters ?? fn.input)
	return { name, args }
}

function normalizeSingleToolPayload(obj: unknown, allowedNames: Set<string>): ParsedJsonTool | undefined {
	if (!obj || typeof obj !== "object") {
		return undefined
	}
	const record = obj as Record<string, unknown>

	if (record.function && typeof record.function === "object") {
		return normalizeFunctionShape(record.function as Record<string, unknown>, allowedNames)
	}

	const name = typeof record.name === "string" ? record.name : undefined
	if (!name || !allowedNames.has(name)) {
		return undefined
	}

	const args = parseArgsField(record.arguments ?? record.parameters ?? record.input ?? record.args)
	return { name, args }
}

function extractToolsFromJsonValue(value: unknown, allowedNames: Set<string>): ParsedJsonTool[] {
	if (!value || typeof value !== "object") {
		return []
	}

	const record = value as Record<string, unknown>

	if (Array.isArray(record.tool_calls)) {
		const tools: ParsedJsonTool[] = []
		for (const item of record.tool_calls) {
			const tool = normalizeSingleToolPayload(item, allowedNames)
			if (tool) {
				tools.push(tool)
			}
		}
		return tools
	}

	const single = normalizeSingleToolPayload(record, allowedNames)
	return single ? [single] : []
}

/**
 * Walks forward from `start` while `text[start] === '{'` and returns the exclusive end index
 * when brace depth returns to zero. Respects quoted strings and escape sequences.
 * Returns undefined when the object is incomplete (streaming partial JSON).
 */
function findBalancedJsonEnd(text: string, start: number): number | undefined {
	if (text[start] !== "{") {
		return undefined
	}

	let depth = 0
	let inString = false
	let escaped = false

	for (let i = start; i < text.length; i++) {
		const ch = text[i]

		if (inString) {
			if (escaped) {
				escaped = false
			} else if (ch === "\\") {
				escaped = true
			} else if (ch === '"') {
				inString = false
			}
			continue
		}

		if (ch === '"') {
			inString = true
			continue
		}

		if (ch === "{") {
			depth++
		} else if (ch === "}") {
			depth--
			if (depth === 0) {
				return i + 1
			}
		}
	}

	return undefined
}

function stringifyParamValue(value: unknown): string {
	if (value === null || value === undefined) {
		return ""
	}
	if (typeof value === "string") {
		return value
	}
	if (typeof value === "boolean" || typeof value === "number") {
		return String(value)
	}
	return JSON.stringify(value)
}

function jsonArgsToToolParams(args: Record<string, unknown>): Partial<Record<ToolParamName, string>> {
	const params: Partial<Record<ToolParamName, string>> = {}
	for (const [key, value] of Object.entries(args)) {
		if (ALLOWED_PARAM_NAMES.has(key as ToolParamName)) {
			params[key as ToolParamName] = stringifyParamValue(value)
		}
	}
	return params
}

function tryParseJsonToolSpan(text: string, start: number, allowedNames: Set<string>): JsonToolSpan | undefined {
	const end = findBalancedJsonEnd(text, start)
	if (end === undefined) {
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(text.slice(start, end))
	} catch {
		return undefined
	}

	const tools = extractToolsFromJsonValue(parsed, allowedNames)
	if (tools.length === 0) {
		return undefined
	}

	return { tools, start, end }
}

/**
 * Scans `message` for complete JSON objects that encode tool calls (Qwen / OpenAI-style).
 * Incomplete objects at EOF are skipped so streaming partial JSON remains plain text.
 */
export function findJsonToolSpans(message: string): JsonToolSpan[] {
	const allowedNames = getAllowedToolNames()
	const spans: JsonToolSpan[] = []
	let i = 0

	while (i < message.length) {
		const ch = message[i]

		// Unwrap ```json ... ``` fenced blocks — common for instruction-tuned local models.
		if (ch === "`" && message.startsWith("```", i)) {
			const fenceEnd = message.indexOf("```", i + 3)
			if (fenceEnd === -1) {
				break
			}
			const headerEnd = message.indexOf("\n", i + 3)
			const contentStart = headerEnd === -1 || headerEnd > fenceEnd ? i + 3 : headerEnd + 1
			const inner = message.slice(contentStart, fenceEnd).trim()
			if (inner.startsWith("{")) {
				const innerSpan = tryParseJsonToolSpan(inner, 0, allowedNames)
				if (innerSpan) {
					spans.push({
						tools: innerSpan.tools,
						start: contentStart,
						end: fenceEnd,
					})
				}
			}
			i = fenceEnd + 3
			continue
		}

		if (ch === "{") {
			const span = tryParseJsonToolSpan(message, i, allowedNames)
			if (span) {
				spans.push(span)
				i = span.end
				continue
			}
		}

		i++
	}

	return spans
}

interface JsonDisplaySpan {
	start: number
	end: number
}

/**
 * Local models sometimes emit focus-chain updates as a standalone JSON object
 * `{"task_progress":"..."}` instead of (or outside) a normal tool payload.
 */
function tryParseTaskProgressOnlySpan(text: string, start: number): JsonDisplaySpan | undefined {
	const end = findBalancedJsonEnd(text, start)
	if (end === undefined) {
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(text.slice(start, end))
	} catch {
		return undefined
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined
	}

	const record = parsed as Record<string, unknown>
	if (typeof record.task_progress !== "string") {
		return undefined
	}

	// Valid tool payloads are removed by findJsonToolSpans (includes embedded task_progress).
	if (extractToolsFromJsonValue(parsed, getAllowedToolNames()).length > 0) {
		return undefined
	}

	return { start, end }
}

export function findTaskProgressJsonSpans(message: string): JsonDisplaySpan[] {
	const spans: JsonDisplaySpan[] = []
	let i = 0

	while (i < message.length) {
		if (message[i] === "{") {
			const span = tryParseTaskProgressOnlySpan(message, i)
			if (span) {
				spans.push(span)
				i = span.end
				continue
			}
		}
		i++
	}

	return spans
}

function mergeNonOverlappingSpans(spans: JsonDisplaySpan[]): JsonDisplaySpan[] {
	if (spans.length === 0) {
		return []
	}
	const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
	const merged: JsonDisplaySpan[] = []
	for (const span of sorted) {
		const last = merged[merged.length - 1]
		if (last && span.start < last.end) {
			continue
		}
		merged.push(span)
	}
	return merged
}

function removeJsonSpansFromText(text: string, spans: JsonDisplaySpan[]): string {
	if (spans.length === 0) {
		return text
	}
	let assembled = ""
	let cursor = 0
	for (const span of spans) {
		assembled += text.slice(cursor, span.start)
		cursor = span.end
	}
	assembled += text.slice(cursor)
	return assembled
}

const PARTIAL_JSON_DISPLAY_OPENERS = [
	'{"tool_calls"',
	'{"function"',
	'{"name"',
	'{"task_progress"',
] as const

/**
 * Strips trailing incomplete JSON that looks like a streaming tool or task_progress payload.
 * Uses shaped openers (not last `{`) so nested `arguments:{` does not confuse the cut point.
 */
function stripTrailingPartialJsonDisplayPayload(text: string): string {
	const trimmedEnd = text.trimEnd()
	let cutIndex = -1

	for (const opener of PARTIAL_JSON_DISPLAY_OPENERS) {
		const idx = trimmedEnd.lastIndexOf(opener)
		if (idx === -1) {
			continue
		}
		if (findBalancedJsonEnd(trimmedEnd, idx) !== undefined) {
			continue
		}
		if (idx > cutIndex) {
			cutIndex = idx
		}
	}

	if (cutIndex === -1) {
		return text
	}

	const trimOffset = text.length - trimmedEnd.length
	return text.slice(0, trimOffset + cutIndex).trimEnd()
}

/**
 * Removes JSON tool-call and task_progress payloads from assistant text before chat display.
 * Mirrors XML/function_calls cleanup in Task.presentAssistantMessage: parsing may already
 * have produced tool_use blocks, but streaming can still have pushed raw JSON as text first.
 */
export function stripJsonToolPayloadsFromDisplayText(text: string): string {
	if (!text) {
		return text
	}

	const toolSpans = findJsonToolSpans(text).map((span) => ({ start: span.start, end: span.end }))
	const displaySpans = mergeNonOverlappingSpans([...toolSpans, ...findTaskProgressJsonSpans(text)])
	let result = removeJsonSpansFromText(text, displaySpans)

	result = result.replace(/<task_progress>[\s\S]*?<\/task_progress>/g, "")

	return stripTrailingPartialJsonDisplayPayload(result).trimEnd()
}

function buildToolUseBlock(tool: ParsedJsonTool): ToolUse {
	return {
		type: "tool_use",
		name: tool.name as ClineDefaultTool,
		params: jsonArgsToToolParams(tool.args),
		partial: false,
		call_id: nanoid(8),
		isNativeToolCall: false,
	}
}

function pushTextBlock(blocks: AssistantMessageContent[], content: string, partial: boolean): void {
	const trimmed = content.trim()
	if (trimmed.length === 0) {
		return
	}
	blocks.push({
		type: "text",
		content: trimmed,
		partial,
	} satisfies TextStreamContent)
}

/**
 * When XML parsing produced no `tool_use` blocks, scan for JSON-shaped tool payloads in the
 * raw assistant message and emit the same `ToolUse` structures the XML path would have produced.
 * XML results are returned unchanged when any tool_use is already present.
 */
export function mergeJsonToolUsesFallback(message: string, xmlBlocks: AssistantMessageContent[]): AssistantMessageContent[] {
	if (xmlBlocks.some((block) => block.type === "tool_use")) {
		return xmlBlocks
	}

	const spans = findJsonToolSpans(message)
	if (spans.length === 0) {
		return xmlBlocks
	}

	const merged: AssistantMessageContent[] = []
	let cursor = 0

	for (const span of spans) {
		pushTextBlock(merged, message.slice(cursor, span.start), false)
		for (const tool of span.tools) {
			merged.push(buildToolUseBlock(tool))
		}
		cursor = span.end
	}

	pushTextBlock(merged, message.slice(cursor), false)

	return merged.length > 0 ? merged : xmlBlocks
}
