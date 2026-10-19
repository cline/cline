import { isUserRunMessage, resolveMessageDisplayRole } from "@cline/core";
import {
	normalizeSessionTitle,
	stringifyMessageContent,
} from "@cline/core/cloud";

export {
	normalizeSessionTitle,
	resolveSessionListTitle,
	stringifyMessageContent,
} from "@cline/core/cloud";

import { readSessionManifest } from "../paths";
import type { JsonRecord } from "../types";

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
			!isUserRunMessage(record) ||
			resolveMessageDisplayRole(record) !== "user" ||
			metadata?.kind === "compaction" ||
			metadata?.kind === "compaction_summary"
		) {
			continue;
		}
		const content = stringifyMessageContent(record.content);
		if (content.trim()) {
			return content.trim();
		}
		if (
			Array.isArray(record.content) &&
			record.content.some(
				(block) =>
					block &&
					typeof block === "object" &&
					(block as JsonRecord).type === "file",
			)
		) {
			return "[file]";
		}
	}
	return undefined;
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
