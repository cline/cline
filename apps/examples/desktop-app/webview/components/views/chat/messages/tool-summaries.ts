import {
	buildToolSummary,
	type ToolSummary,
} from "@cline/ui/components/agent-chat/tool-summary";
import { z } from "zod";
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

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function recordString(
	record: Record<string, unknown> | null | undefined,
	key: string,
	fallback = "",
): string {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function extractRunCommandOutput(value: unknown): string {
	const normalized = normalizeDisplayValue(value);
	if (typeof normalized === "string") return normalized;
	const records = Array.isArray(normalized)
		? normalized.map(asRecord).filter((record) => record !== null)
		: [asRecord(normalized)].filter((record) => record !== null);
	const includeCommand = records.length > 1;
	return records
		.map((record) => {
			const result = recordString(record, "result");
			const error = recordString(record, "error");
			const output = result || error;
			if (!output) return "";
			const query = recordString(record, "query");
			return includeCommand && query ? `$ ${query}\n${output}` : output;
		})
		.filter(Boolean)
		.join("\n\n");
}

/**
 * The final answer carried in a `submit_and_exit` call's input. Present as
 * soon as the call starts; the result merely echoes it back.
 */
export function extractSubmitSummaryText(payload: ToolPayload | null): string {
	const input = asRecord(normalizeDisplayValue(payload?.input));
	return recordString(input, "summary");
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

function parseToolMessage(message: ChatMessage) {
	const payload = parseToolPayload(message.content);
	const toolName = message.meta?.toolName || payload?.toolName || "tool";
	const hookEventName = message.meta?.hookEventName;
	const inProgress =
		hookEventName === "tool_call_start" ||
		hookEventName === "history_tool_use" ||
		(Boolean(payload) && payload?.result == null && !payload?.isError);
	return { payload, toolName, inProgress };
}

export function buildToolPresentation(message: ChatMessage): ToolPresentation {
	const { payload, toolName, inProgress } = parseToolMessage(message);
	const summary = buildToolSummary({
		toolName,
		input: payload?.input,
		result: payload?.result,
		isError: Boolean(payload?.isError),
		inProgress,
	});
	return { message, payload, toolName, inProgress, summary };
}

const PublicationSchema = z.object({
	files: z
		.array(
			z.union([
				z.object({
					path: z.string(),
					error: z.object({ code: z.string(), message: z.string() }),
				}),
				z.object({
					path: z.string(),
					artifactId: z.string().min(1),
					error: z.never().optional(),
				}),
			]),
		)
		.nonempty(),
});

export function parsePublishedArtifacts(value: unknown) {
	const parsed = PublicationSchema.safeParse(normalizeDisplayValue(value));
	return parsed.success ? parsed.data.files : undefined;
}

export type PublishedFile = z.infer<
	typeof PublicationSchema
>["files"][number] & { caption?: string };

export function getPublishedArtifacts(
	message: ChatMessage,
): PublishedFile[] | undefined {
	if (message.role !== "tool" || !message.sessionId) return undefined;
	const { payload, toolName, inProgress } = parseToolMessage(message);
	if (toolName !== "publish_artifacts" || inProgress || payload?.isError)
		return undefined;
	// Results are returned in input order, so captions pair up by index.
	const inputs = asRecord(normalizeDisplayValue(payload?.input))?.files;
	return parsePublishedArtifacts(payload?.result)?.map((file, index) => {
		const caption = Array.isArray(inputs)
			? recordString(asRecord(inputs[index]), "caption").trim()
			: "";
		return caption ? { ...file, caption } : file;
	});
}

/** Recognize the semantic result, independently of the tool or agent producing it. */
export function isUxVerificationMessage(message: ChatMessage): boolean {
	if (message.role !== "tool") return false;
	const output = normalizeDisplayValue(
		parseToolPayload(message.content)?.result,
	);
	return Boolean(
		output &&
			typeof output === "object" &&
			"kind" in output &&
			output.kind === "ux_verification",
	);
}
