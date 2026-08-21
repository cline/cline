import {
	buildToolSummary,
	type ToolSummary,
} from "@cline/ui/components/agent-chat/tool-summary";
import type { ChatMessage } from "@/lib/chat-schema";

/**
 * Thin presentation layer between the desktop chat transcript and the shared
 * `@cline/ui` tool-summary module: it owns the app's tool-message payload
 * schema and hook-event conventions, then delegates label/detail/diff
 * construction to `buildToolSummary`.
 */
export type ToolPayload = {
	toolName?: string;
	input?: unknown;
	result?: unknown;
	isError?: boolean;
};

export function parseJsonString(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

export function normalizeDisplayValue(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	const trimmed = value.trim();
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		return parseJsonString(trimmed);
	}
	return value;
}

export function formatToolValue(value: unknown): string {
	const normalized = normalizeDisplayValue(value);
	if (normalized == null) {
		return "";
	}
	if (typeof normalized === "string") {
		return normalized;
	}
	if (
		typeof normalized === "object" &&
		"error" in normalized &&
		typeof normalized.error === "string"
	) {
		return normalized.error;
	}
	try {
		return JSON.stringify(normalized, null, 2);
	} catch {
		return String(normalized);
	}
}

export function parseToolPayload(raw: string): ToolPayload | null {
	try {
		return JSON.parse(raw) as ToolPayload;
	} catch {
		return null;
	}
}

export type ToolPresentation = {
	message: ChatMessage;
	payload: ToolPayload | null;
	toolName: string;
	inProgress: boolean;
	summary: ToolSummary;
};

// Tool results can contain complete web pages, command logs, or other large
// payloads. Keeping the preview bounded prevents a historical transcript from
// creating a very large hidden DOM subtree when it is opened in the web app.
// The canonical result remains intact in session storage.
const MAX_TOOL_OUTPUT_PREVIEW_CHARS = 16 * 1024;

export function buildToolPresentation(message: ChatMessage): ToolPresentation {
	const payload = parseToolPayload(message.content);
	const toolName = message.meta?.toolName || payload?.toolName || "tool";
	const hookEventName = message.meta?.hookEventName;
	const inProgress =
		hookEventName === "tool_call_start" ||
		hookEventName === "history_tool_use" ||
		(Boolean(payload) && payload?.result == null && !payload?.isError);
	const summary = buildToolSummary(
		{
			toolName,
			input: payload?.input,
			result: payload?.result,
			isError: Boolean(payload?.isError),
			inProgress,
		},
		{
			maxOutputChars: MAX_TOOL_OUTPUT_PREVIEW_CHARS,
		},
	);
	return { message, payload, toolName, inProgress, summary };
}
