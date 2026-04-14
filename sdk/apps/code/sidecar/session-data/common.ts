import { normalizeUserInput } from "@clinebot/shared";
import { readSessionManifest } from "../paths";
import type { JsonRecord } from "../types";

export function normalizeSessionTitle(
	title?: string | null,
): string | undefined {
	const trimmed = title?.trim();
	return trimmed ? normalizeUserInput(trimmed).slice(0, 120) : undefined;
}

export function parseTimestamp(value?: string | number | null): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (!trimmed) {
		return Number.NEGATIVE_INFINITY;
	}
	const maybeEpoch = Number(trimmed);
	if (Number.isFinite(maybeEpoch)) {
		if (/^\d{10}$/.test(trimmed)) {
			return maybeEpoch * 1000;
		}
		return maybeEpoch;
	}
	const parsed = new Date(trimmed).getTime();
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function compareSessionRecordsByStartedAtDesc(
	left: JsonRecord,
	right: JsonRecord,
): number {
	const timeDelta =
		parseTimestamp(right.startedAt as string | number | undefined) -
		parseTimestamp(left.startedAt as string | number | undefined);
	if (timeDelta !== 0) {
		return timeDelta;
	}
	const leftId = String(left.sessionId ?? "");
	const rightId = String(right.sessionId ?? "");
	return rightId.localeCompare(leftId);
}

export function stringifyMessageContent(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (const block of value) {
			if (typeof block === "string") {
				if (block.trim()) {
					parts.push(block);
				}
				continue;
			}
			if (!block || typeof block !== "object") {
				continue;
			}
			const record = block as JsonRecord;
			const blockType = typeof record.type === "string" ? record.type : "";
			const piece =
				blockType === "text"
					? String(record.text ?? "")
					: blockType === "thinking"
						? String(record.thinking ?? "")
						: blockType === "tool_use"
							? `[tool] ${String(record.name ?? "tool_call")}`
							: blockType === "tool_result"
								? `[tool_result]\n${stringifyMessageContent(record.content)}`
								: blockType === "image"
									? "[image]"
									: blockType === "redacted_thinking"
										? "[redacted_thinking]"
										: typeof record.text === "string"
											? record.text
											: "";
			if (piece.trim()) {
				parts.push(piece);
			}
		}
		return parts.join("\n");
	}
	if (value && typeof value === "object") {
		const record = value as JsonRecord;
		if (typeof record.text === "string") {
			return record.text;
		}
	}
	return "";
}

function titleFromPrompt(prompt?: string | null): string | undefined {
	const normalized = normalizeSessionTitle(prompt ?? undefined);
	if (!normalized) {
		return undefined;
	}
	return normalized.split("\n")[0]?.trim().slice(0, 70) || undefined;
}

function titleFromMessages(messages: unknown[]): string | undefined {
	for (const role of ["user", "assistant"] as const) {
		for (const rawMessage of messages) {
			if (!rawMessage || typeof rawMessage !== "object") {
				continue;
			}
			const message = rawMessage as JsonRecord;
			if (message.role !== role) {
				continue;
			}
			const text = normalizeSessionTitle(
				stringifyMessageContent(message.content),
			);
			if (!text) {
				continue;
			}
			return text.split("\n")[0]?.trim().slice(0, 70) || undefined;
		}
	}
	return undefined;
}

export function derivePromptFromMessages(
	messages: unknown[],
): string | undefined {
	for (const message of messages) {
		if (!message || typeof message !== "object") {
			continue;
		}
		const record = message as JsonRecord;
		if (record.role !== "user") {
			continue;
		}
		const metadata =
			record.metadata && typeof record.metadata === "object"
				? (record.metadata as JsonRecord)
				: undefined;
		if (
			typeof metadata?.kind === "string" &&
			metadata.kind === "recovery_notice"
		) {
			continue;
		}
		const content = stringifyMessageContent(record.content);
		if (content.trim()) {
			return content.trim();
		}
	}
	return undefined;
}

export function resolveSessionListTitle(options: {
	sessionId: string;
	metadata?: unknown;
	prompt?: string | null;
	messages?: unknown[];
}): string {
	const metadataTitle =
		options.metadata && typeof options.metadata === "object"
			? normalizeSessionTitle(
					(options.metadata as JsonRecord).title as string | undefined,
				)
			: undefined;
	if (metadataTitle) {
		return metadataTitle.slice(0, 70);
	}
	const promptTitle = titleFromPrompt(options.prompt);
	if (promptTitle) {
		return promptTitle;
	}
	const messageTitle = options.messages
		? titleFromMessages(options.messages)
		: undefined;
	if (messageTitle) {
		return messageTitle;
	}
	return `Session ${options.sessionId.slice(-6)}`;
}

export function readSessionMetadataTitle(
	sessionId: string,
): string | undefined {
	const metadata = readSessionManifest(sessionId)?.metadata;
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	return normalizeSessionTitle(
		(metadata as JsonRecord).title as string | undefined,
	);
}

export function parseU64Value(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.trunc(value);
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return undefined;
}

export function parseF64Value(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return undefined;
}

export function normalizeChatFinishStatus(status?: string): string {
	const normalized = status?.trim().toLowerCase() || "";
	if (!normalized) {
		return "completed";
	}
	if (
		normalized.includes("cancel") ||
		normalized.includes("abort") ||
		normalized.includes("interrupt")
	) {
		return "cancelled";
	}
	if (normalized.includes("fail") || normalized.includes("error")) {
		return "failed";
	}
	if (normalized.includes("run") || normalized.includes("start")) {
		return "running";
	}
	if (
		normalized.includes("complete") ||
		normalized.includes("done") ||
		normalized.includes("stop") ||
		normalized.includes("mistake_limit") ||
		normalized.includes("mistake-limit") ||
		normalized.includes("max_iteration") ||
		normalized.includes("max-iteration")
	) {
		return "completed";
	}
	return "idle";
}
