import type { ChatMessage } from "@/lib/chat-schema";

/**
 * Header-level accounting of the child agents a session has started.
 *
 * There is no dedicated subagent event on the wire: the sidecar forwards
 * subagent activity into the parent session's stream without an agentId
 * (see sidecar/context.ts), so the only per-agent signal the webview can see
 * is the spawning tool call itself. Every counting rule below is therefore
 * derived from tool messages, which stay correct for live turns, for turns
 * materialized from a run result, and for hydrated history alike.
 */

export type SessionAgentRunState =
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	/** Dispatched, but no observed outcome — a run interrupted by a crash or reload. */
	| "unresolved";

export type SessionAgentActivity = {
	total: number;
	running: number;
	completed: number;
	failed: number;
	cancelled: number;
	unresolved: number;
};

export const EMPTY_AGENT_ACTIVITY: SessionAgentActivity = {
	total: 0,
	running: 0,
	completed: 0,
	failed: 0,
	cancelled: 0,
	unresolved: 0,
};

/**
 * `spawn_agent` runs the sub-agent inside its own execute(), so the tool call's
 * lifetime is the sub-agent's lifetime. Older transcripts recorded the same
 * call as `subagent_<name>`.
 */
const SUBAGENT_RUN_TOOL_NAMES = new Set([
	"spawn_agent",
	"spawn-agent",
	"spawn_agent_tool",
]);

const TEAM_RUN_TOOL_NAME = "team_run_task";

/** Tools whose results report the current status of previously dispatched runs. */
const TEAM_RUN_REPORT_TOOL_NAMES = new Set([
	"team_await_runs",
	"team_list_runs",
	"team_cancel_run",
]);

function normalizeToolName(toolName: string | undefined): string {
	return toolName?.trim().toLowerCase() ?? "";
}

function isSubagentRunTool(toolName: string): boolean {
	return (
		SUBAGENT_RUN_TOOL_NAMES.has(toolName) || toolName.startsWith("subagent_")
	);
}

export function isAgentRunToolName(toolName: string | undefined): boolean {
	const normalized = normalizeToolName(toolName);
	return isSubagentRunTool(normalized) || normalized === TEAM_RUN_TOOL_NAME;
}

type ToolPayload = {
	toolName?: string;
	input?: unknown;
	result?: unknown;
	isError?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * Hydrated `tool_result` blocks carry the payload as text, so a result that
 * arrived as JSON has to be reparsed before its fields can be read.
 */
function normalizeResult(result: unknown): unknown {
	if (typeof result !== "string") {
		return result;
	}
	const trimmed = result.trim();
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
		return result;
	}
	return parseJson(trimmed) ?? result;
}

function toStringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Mirrors ToolActivity's in-progress rule so the header agrees with the transcript. */
function isToolCallInProgress(
	hookEventName: string | undefined,
	payload: ToolPayload | null,
): boolean {
	if (
		hookEventName === "tool_call_start" ||
		hookEventName === "history_tool_use"
	) {
		return true;
	}
	return Boolean(payload) && payload?.result == null && !payload?.isError;
}

function mapTeamRunStatus(status: string | undefined): SessionAgentRunState {
	switch (status) {
		case "queued":
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
		case "interrupted":
			return "cancelled";
		default:
			return "running";
	}
}

/** A sub-agent that hit its abort signal reports `finishReason: "aborted"`. */
function subagentStateFromResult(result: unknown): SessionAgentRunState {
	const finishReason = toStringValue(
		asRecord(normalizeResult(result))?.finishReason,
	);
	return finishReason === "aborted" ? "cancelled" : "completed";
}

function collectRunReports(
	result: unknown,
): Array<{ id: string; status?: string }> {
	const normalized = normalizeResult(result);
	const entries = Array.isArray(normalized) ? normalized : [normalized];
	const out: Array<{ id: string; status?: string }> = [];
	for (const entry of entries) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}
		// team_list_runs/team_await_runs report `id`; team_cancel_run reports `runId`.
		const id = toStringValue(record.id) ?? toStringValue(record.runId);
		if (!id) {
			continue;
		}
		out.push({ id, status: toStringValue(record.status) });
	}
	return out;
}

/**
 * Fold a session's tool messages into per-run states.
 *
 * Sub-agent runs and *sync* teammate runs are keyed by their tool message id,
 * because the tool call returns only once the agent is done. An *async*
 * teammate run returns a `runId` immediately and keeps working in the
 * background, so it is keyed by that runId and its state is refined by any
 * later team_await_runs / team_list_runs / team_cancel_run result.
 */
function collectAgentRunStates(
	messages: ChatMessage[],
): Map<string, SessionAgentRunState> {
	const states = new Map<string, SessionAgentRunState>();
	const asyncRunIds = new Set<string>();

	for (const message of messages) {
		if (message.role !== "tool") {
			continue;
		}
		const metaToolName = normalizeToolName(message.meta?.toolName);
		const isRunTool =
			isSubagentRunTool(metaToolName) || metaToolName === TEAM_RUN_TOOL_NAME;
		const isReportTool = TEAM_RUN_REPORT_TOOL_NAMES.has(metaToolName);
		// Parsing every tool payload would cost a JSON.parse per message on each
		// streaming flush, so only messages that can matter are parsed. A message
		// without meta.toolName is parsed to recover the name from the payload.
		if (metaToolName && !isRunTool && !isReportTool) {
			continue;
		}
		const payload = parseJson(message.content) as ToolPayload | undefined;
		const toolName = metaToolName || normalizeToolName(payload?.toolName);
		if (!toolName) {
			continue;
		}

		if (TEAM_RUN_REPORT_TOOL_NAMES.has(toolName)) {
			for (const report of collectRunReports(payload?.result)) {
				if (asyncRunIds.has(report.id)) {
					states.set(report.id, mapTeamRunStatus(report.status));
				}
			}
			continue;
		}

		const isSubagent = isSubagentRunTool(toolName);
		if (!isSubagent && toolName !== TEAM_RUN_TOOL_NAME) {
			continue;
		}

		if (isToolCallInProgress(message.meta?.hookEventName, payload ?? null)) {
			states.set(message.id, "running");
			continue;
		}
		if (payload?.isError) {
			states.set(message.id, "failed");
			continue;
		}
		if (isSubagent) {
			states.set(message.id, subagentStateFromResult(payload?.result));
			continue;
		}

		// team_run_task: only async mode outlives its tool call. Its returned
		// `status` is unreliable in sync mode (it reports "running" on success),
		// so the dispatch mode decides how the run is tracked.
		const result = asRecord(normalizeResult(payload?.result));
		const requestedMode = toStringValue(asRecord(payload?.input)?.runMode);
		const mode = toStringValue(result?.mode) ?? requestedMode;
		const runId = toStringValue(result?.runId);
		if (mode === "async" && runId) {
			asyncRunIds.add(runId);
			states.set(runId, mapTeamRunStatus(toStringValue(result?.status)));
			// Drop the dispatching call's own entry: the run it started is tracked
			// under runId, and counting both would double count one agent.
			states.delete(message.id);
			continue;
		}
		states.set(message.id, "completed");
	}

	return states;
}

/**
 * Count the child agents started during a session, bucketed by outcome.
 *
 * `sessionActive` distinguishes a run that is genuinely still working from one
 * that was recorded without an outcome — a hydrated transcript keeps its
 * unfinished `tool_use` blocks forever, and reporting those as "running" in an
 * idle session would be wrong.
 */
export function buildSessionAgentActivity(
	messages: ChatMessage[],
	options?: { sessionActive?: boolean },
): SessionAgentActivity {
	const sessionActive = options?.sessionActive ?? false;
	const states = collectAgentRunStates(messages);
	if (states.size === 0) {
		return EMPTY_AGENT_ACTIVITY;
	}

	const activity: SessionAgentActivity = {
		...EMPTY_AGENT_ACTIVITY,
		total: states.size,
	};
	for (const state of states.values()) {
		if (state === "running") {
			if (sessionActive) {
				activity.running += 1;
			} else {
				activity.unresolved += 1;
			}
			continue;
		}
		activity[state] += 1;
	}
	return activity;
}

export function hasAgentActivity(activity: SessionAgentActivity): boolean {
	return activity.total > 0;
}

/**
 * One child agent as recorded by the backend, from `list_session_agents`.
 *
 * The roster is authoritative where it exists: it carries each agent's real
 * persisted status and its own session id, which is what makes peeking at a
 * transcript possible. It lags the live stream though — a row appears only once
 * the runtime has persisted the spawn — so counts still fall back to the
 * message-derived tally while a turn is in flight.
 */
export type SessionAgentEntry = {
	sessionId: string;
	agentId: string;
	parentAgentId?: string;
	kind: "subagent" | "teamtask";
	status: string;
	/** The task the agent was given — its first prompt. */
	prompt?: string;
	/** Most recent step the agent took, for an at-a-glance progress line. */
	lastAction?: string;
	teamName?: string;
	provider?: string;
	model?: string;
	startedAt: string;
	endedAt?: string;
	hasMessages: boolean;
};

/** Persisted session statuses map onto the same buckets as tool-derived runs. */
export function agentEntryState(status: string): SessionAgentRunState {
	switch (status.trim().toLowerCase()) {
		case "running":
		case "pending":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "idle":
			return "unresolved";
		default:
			return "unresolved";
	}
}

export function summarizeAgentEntries(
	entries: SessionAgentEntry[],
): SessionAgentActivity {
	const activity: SessionAgentActivity = {
		...EMPTY_AGENT_ACTIVITY,
		total: entries.length,
	};
	for (const entry of entries) {
		activity[agentEntryState(entry.status)] += 1;
	}
	return activity;
}

/**
 * Reconcile the persisted roster with the live tool-derived tally.
 *
 * Neither source is complete on its own: the roster knows each agent's identity
 * and true status but only after persistence, while the tally sees a spawn the
 * moment its tool call starts but can never name the agent. Taking the larger
 * total keeps a just-started agent visible without double counting one that
 * both sources already agree on.
 */
export function mergeAgentActivity(
	entries: SessionAgentEntry[],
	derived: SessionAgentActivity,
	options?: { sessionActive?: boolean },
): SessionAgentActivity {
	if (entries.length === 0) {
		return derived;
	}
	const roster = summarizeAgentEntries(entries);
	if (derived.total <= roster.total) {
		return roster;
	}
	// Extra spawns the roster has not caught up with are still in flight.
	const pending = derived.total - roster.total;
	const sessionActive = options?.sessionActive ?? false;
	return {
		...roster,
		total: derived.total,
		running: roster.running + (sessionActive ? pending : 0),
		unresolved: roster.unresolved + (sessionActive ? 0 : pending),
	};
}

/** Screen-reader / tooltip text: "3 agents: 1 running, 2 completed". */
export function describeAgentActivity(activity: SessionAgentActivity): string {
	const parts: string[] = [];
	if (activity.running > 0) {
		parts.push(`${activity.running} running`);
	}
	if (activity.completed > 0) {
		parts.push(`${activity.completed} completed`);
	}
	if (activity.failed > 0) {
		parts.push(`${activity.failed} failed`);
	}
	if (activity.cancelled > 0) {
		parts.push(`${activity.cancelled} cancelled`);
	}
	if (activity.unresolved > 0) {
		parts.push(`${activity.unresolved} with no recorded outcome`);
	}
	const noun = activity.total === 1 ? "agent" : "agents";
	if (parts.length === 0) {
		return `${activity.total} ${noun}`;
	}
	return `${activity.total} ${noun}: ${parts.join(", ")}`;
}
