import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureHookLogDir } from "@cline/shared/storage";
import { sessionHookLogFileName } from "../../services/session-artifacts";
import type { SessionReplayRedactor } from "./bundle-redaction";
import type { SessionReplayEvent } from "./bundle-schema";

export type RawHookLogEntry = Record<string, unknown>;

export interface SessionHookLogSelection {
	source: "session-log" | "global-log" | "none";
	path?: string;
	/** Entries of the root agent, in log order. */
	rootEntries: RawHookLogEntry[];
	/** Entries of subagents/teammates of the same session tree, in log order. */
	descendantEntries: RawHookLogEntry[];
	/** Lines that were not valid JSON objects. */
	skippedLines: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function resolveGlobalHookLogPath(): string {
	return (
		process.env.CLINE_HOOKS_LOG_PATH?.trim() ||
		join(ensureHookLogDir(), "hooks.jsonl")
	);
}

export function resolveSessionHookLogPath(
	sessionsDir: string,
	rootSessionId: string,
): string {
	return join(
		sessionsDir,
		rootSessionId,
		sessionHookLogFileName(rootSessionId),
	);
}

export function parseHookLog(contents: string): {
	entries: RawHookLogEntry[];
	skippedLines: number;
} {
	const entries: RawHookLogEntry[] = [];
	let skippedLines = 0;
	for (const line of contents.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as unknown;
			if (isRecord(parsed)) {
				entries.push(parsed);
			} else {
				skippedLines += 1;
			}
		} catch {
			skippedLines += 1;
		}
	}
	return { entries, skippedLines };
}

/**
 * Whether a hook log entry belongs to the session tree rooted at
 * `rootSessionId`. Audit entries carry `sessionContext.rootSessionId`; stale
 * session shutdown records carry a top-level `sessionId`.
 */
export function hookEntryBelongsToSessionTree(
	entry: RawHookLogEntry,
	rootSessionId: string,
): boolean {
	const context = isRecord(entry.sessionContext)
		? entry.sessionContext
		: undefined;
	return (
		asString(context?.rootSessionId) === rootSessionId ||
		asString(entry.sessionId) === rootSessionId
	);
}

/** Root-agent entries have no parent agent; subagents always have one. */
export function isRootAgentHookEntry(entry: RawHookLogEntry): boolean {
	return asString(entry.parent_agent_id) === undefined;
}

/**
 * Selects the hook events of one session tree. Prefers the per-session log
 * written next to the session's artifacts; falls back to filtering the global
 * log for sessions recorded before per-session logs existed.
 */
export async function selectSessionHookLogEntries(input: {
	rootSessionId: string;
	sessionsDir: string;
	globalLogPath?: string;
}): Promise<SessionHookLogSelection> {
	const sessionLogPath = resolveSessionHookLogPath(
		input.sessionsDir,
		input.rootSessionId,
	);
	const globalLogPath = input.globalLogPath ?? resolveGlobalHookLogPath();
	const candidates: Array<{
		source: "session-log" | "global-log";
		path: string;
	}> = [
		{ source: "session-log", path: sessionLogPath },
		{ source: "global-log", path: globalLogPath },
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate.path)) {
			continue;
		}
		const { entries, skippedLines } = parseHookLog(
			await readFile(candidate.path, "utf8"),
		);
		const tree = entries.filter((entry) =>
			hookEntryBelongsToSessionTree(entry, input.rootSessionId),
		);
		return {
			source: candidate.source,
			path: candidate.path,
			rootEntries: tree.filter(isRootAgentHookEntry),
			descendantEntries: tree.filter((entry) => !isRootAgentHookEntry(entry)),
			skippedLines,
		};
	}
	return {
		source: "none",
		rootEntries: [],
		descendantEntries: [],
		skippedLines: 0,
	};
}

function readToolCallId(entry: RawHookLogEntry): string | undefined {
	const call = isRecord(entry.tool_call) ? entry.tool_call : undefined;
	const result = isRecord(entry.tool_result) ? entry.tool_result : undefined;
	return asString(call?.id) ?? asString(result?.id);
}

/**
 * Converts hook log entries to bundle events. The envelope (name, ids,
 * iteration, timestamp) is lifted from the raw entry before the payload is
 * redacted, so correlation survives redaction.
 */
export function toSessionReplayHookEvents(input: {
	sessionId: string;
	entries: readonly RawHookLogEntry[];
	redactor: SessionReplayRedactor;
	file: string;
}): SessionReplayEvent[] {
	const events: SessionReplayEvent[] = [];
	for (const entry of input.entries) {
		const name = asString(entry.hookName);
		const ts = asString(entry.ts) ?? asString(entry.timestamp);
		if (!name || !ts) {
			continue;
		}
		const index = events.length;
		const iteration = entry.iteration;
		const toolCallId = readToolCallId(entry);
		const seq = entry.seq;
		events.push({
			index,
			...(typeof seq === "number" && Number.isInteger(seq) && seq >= 0
				? { seq }
				: {}),
			ts,
			kind: "hook",
			name,
			sessionId: input.sessionId,
			agentId: asString(entry.agent_id) ?? null,
			parentAgentId: asString(entry.parent_agent_id) ?? null,
			...(typeof iteration === "number" &&
			Number.isInteger(iteration) &&
			iteration >= 0
				? { iteration }
				: {}),
			...(toolCallId ? { toolCallId } : {}),
			payload: input.redactor.redact(
				{ ...entry },
				input.file,
				`[${index}].payload`,
			),
		});
	}
	return events;
}
