import { existsSync, readFileSync } from "node:fs";
import { SqliteSessionStore } from "@cline/core";
import type { MessageWithMetadata } from "@cline/shared";

/**
 * Child agents of a chat session: `spawn_agent` subagent runs and team-task
 * teammate runs. Both are persisted as sessions parented to the root session
 * (see the SDK's team-child-session-manager), which is the only place their
 * real status lives — the tool events forwarded to the webview carry no agent
 * attribution at all.
 */
export type SessionAgentRecord = {
	sessionId: string;
	agentId: string;
	parentAgentId?: string;
	/** "subagent" for spawn_agent runs, "teamtask" for team-task runs. */
	kind: "subagent" | "teamtask";
	status: string;
	/** The task the agent was given — its first prompt. */
	prompt?: string;
	/** Most recent thing the agent did, for an at-a-glance progress line. */
	lastAction?: string;
	teamName?: string;
	provider?: string;
	model?: string;
	startedAt: string;
	endedAt?: string;
	/** Whether a transcript exists to open yet. */
	hasMessages: boolean;
};

const TEAM_TASK_MARKER = "__teamtask__";
const LAST_ACTION_LIMIT = 160;

function readMessagesFile(path: string): MessageWithMetadata[] | null {
	if (!path || !existsSync(path)) {
		return null;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as
			| { messages?: MessageWithMetadata[] }
			| MessageWithMetadata[];
		if (Array.isArray(parsed)) {
			return parsed;
		}
		return Array.isArray(parsed.messages) ? parsed.messages : [];
	} catch {
		return null;
	}
}

/**
 * A child row records where its transcript was written. Deriving the path here
 * instead would mean duplicating the SDK's artifact layout, which nests child
 * transcripts under the root session directory keyed by agent id.
 */
function resolveChildMessagesPath(record: {
	messagesPath?: string;
}): string | undefined {
	return record.messagesPath?.trim() || undefined;
}

/**
 * Transcript of a child agent session, or null when the id is not a child or
 * nothing has been written yet. Lets the ordinary session-reading path open a
 * subagent session without knowing where child artifacts live.
 */
export function readChildSessionMessages(
	sessionId: string,
): MessageWithMetadata[] | null {
	const trimmed = sessionId.trim();
	if (!trimmed) {
		return null;
	}
	let record: { parentSessionId?: string; messagesPath?: string } | undefined;
	try {
		record = new SqliteSessionStore().get(trimmed);
	} catch {
		// No session database on this host; nothing to resolve.
		return null;
	}
	if (!record?.parentSessionId) {
		return null;
	}
	const messagesPath = resolveChildMessagesPath(record);
	return messagesPath ? readMessagesFile(messagesPath) : null;
}

function truncate(value: string, limit = LAST_ACTION_LIMIT): string {
	const collapsed = value.replace(/\s+/g, " ").trim();
	return collapsed.length > limit
		? `${collapsed.slice(0, limit)}...`
		: collapsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

/**
 * Summarize the agent's most recent step from the tail of its transcript.
 *
 * A tool call names itself usefully ("Running read_files"), so it wins over
 * prose; assistant text is the fallback. Reasoning blocks are skipped — they
 * describe intent rather than an action taken.
 */
function deriveLastAction(messages: unknown[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = asRecord(messages[index]);
		if (!message || message.role !== "assistant") {
			continue;
		}
		const content = message.content;
		if (typeof content === "string") {
			const text = truncate(content);
			if (text) {
				return text;
			}
			continue;
		}
		if (!Array.isArray(content)) {
			continue;
		}
		for (
			let blockIndex = content.length - 1;
			blockIndex >= 0;
			blockIndex -= 1
		) {
			const block = asRecord(content[blockIndex]);
			if (!block) {
				continue;
			}
			if (block.type === "tool_use" && typeof block.name === "string") {
				return `Running ${block.name}`;
			}
			if (block.type === "text" && typeof block.text === "string") {
				const text = truncate(block.text);
				if (text) {
					return text;
				}
			}
		}
	}
	return undefined;
}

export function listSessionAgents(
	rootSessionId: string,
	limit = 200,
): SessionAgentRecord[] {
	const trimmedRootId = rootSessionId.trim();
	if (!trimmedRootId) {
		return [];
	}
	const store = new SqliteSessionStore();
	const out: SessionAgentRecord[] = [];
	for (const record of store.listChildren(trimmedRootId, limit)) {
		const agentId = record.agentId?.trim();
		if (!agentId) {
			continue;
		}
		const messagesPath = resolveChildMessagesPath(record);
		const messages = messagesPath ? readMessagesFile(messagesPath) : null;
		out.push({
			sessionId: record.sessionId,
			agentId,
			parentAgentId: record.parentAgentId,
			kind: record.sessionId.includes(TEAM_TASK_MARKER)
				? "teamtask"
				: "subagent",
			status: record.status,
			prompt: record.prompt,
			lastAction: messages?.length ? deriveLastAction(messages) : undefined,
			teamName: record.teamName,
			provider: record.provider || undefined,
			model: record.model || undefined,
			startedAt: record.startedAt,
			endedAt: record.endedAt ?? undefined,
			hasMessages: Boolean(messages && messages.length > 0),
		});
	}
	return out;
}
