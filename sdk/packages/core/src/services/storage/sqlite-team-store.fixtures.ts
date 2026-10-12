import type { TeamRuntimeStateDelta } from "../../extensions/tools/team";
import type { TeamPersistenceBatch } from "../../types/storage";

// Shared fixtures for sqlite-team-store tests (not a test file itself).

export const TEAM = "team-a";
export const fixedNow = new Date("2026-09-30T00:00:00.000Z");

export function emptyDelta(
	overrides: Partial<TeamRuntimeStateDelta> = {},
): TeamRuntimeStateDelta {
	return {
		teamId: "t_1",
		teamName: TEAM,
		reset: false,
		members: [{ agentId: "lead", role: "lead", status: "idle" }],
		tasks: [],
		mailbox: [],
		missionLog: [],
		runs: [],
		outcomes: [],
		outcomeFragments: [],
		...overrides,
	};
}

export function batch(
	delta: TeamRuntimeStateDelta,
	events: TeamPersistenceBatch["events"] = [],
	teammates: TeamPersistenceBatch["teammates"] = [],
): TeamPersistenceBatch {
	return {
		events,
		delta,
		teammates,
		getFullState: () => {
			throw new Error("sqlite store must not request full state");
		},
	};
}

export function task(id: string, status: "pending" | "completed" = "pending") {
	return {
		id,
		title: id,
		description: "d",
		status,
		createdAt: fixedNow,
		updatedAt: fixedNow,
		createdBy: "lead",
		dependsOn: [],
	};
}

export function run(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		agentId: "worker",
		status: "running" as const,
		message: "m",
		priority: 0,
		retryCount: 0,
		maxRetries: 0,
		startedAt: fixedNow,
		...extra,
	};
}

export const fullAgentResult = {
	text: "done",
	iterations: 2,
	finishReason: "completed",
	durationMs: 5,
	usage: { inputTokens: 1, outputTokens: 2 },
	messages: [{ content: "TRANSCRIPT".repeat(100) }],
};

/** Original (pre-v2) schema, copied verbatim, for migration tests. */
export const V1_SCHEMA_SQL = `
	CREATE TABLE team_store_schema_version (lock INTEGER PRIMARY KEY CHECK (lock = 1), version INTEGER NOT NULL);
	INSERT INTO team_store_schema_version (lock, version) VALUES (1, 1);
	CREATE TABLE team_events (id INTEGER PRIMARY KEY AUTOINCREMENT, team_name TEXT NOT NULL, ts TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, causation_id TEXT, correlation_id TEXT);
	CREATE TABLE team_runtime_snapshot (team_name TEXT PRIMARY KEY, state_json TEXT NOT NULL, teammates_json TEXT NOT NULL, updated_at TEXT NOT NULL);
	CREATE TABLE team_tasks (team_name TEXT NOT NULL, task_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, assignee TEXT, depends_on_json TEXT NOT NULL, summary TEXT, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, PRIMARY KEY(team_name, task_id));
	CREATE TABLE team_runs (team_name TEXT NOT NULL, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, task_id TEXT, status TEXT NOT NULL, message TEXT NOT NULL, started_at TEXT, ended_at TEXT, error TEXT, lease_owner TEXT, heartbeat_at TEXT, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(team_name, run_id));
	CREATE TABLE team_outcomes (team_name TEXT NOT NULL, outcome_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, schema_json TEXT NOT NULL, finalized_at TEXT, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(team_name, outcome_id));
	CREATE TABLE team_outcome_fragments (team_name TEXT NOT NULL, outcome_id TEXT NOT NULL, fragment_id TEXT NOT NULL, section TEXT NOT NULL, source_agent_id TEXT NOT NULL, source_run_id TEXT, content TEXT NOT NULL, status TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(team_name, fragment_id));
`;
