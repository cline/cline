import type { TeamTeammateSpec } from "@clinebot/shared";
import type { AgentTeamsRuntime } from "../../extensions/tools/team";
import type { SessionSource, SessionStatus } from "../../types/common";
import type { SessionManifest } from "./session-manifest";

export interface SessionRow {
	sessionId: string;
	source: string;
	pid: number;
	startedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	status: SessionStatus;
	statusLock: number;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string | null;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	parentSessionId?: string | null;
	parentAgentId?: string | null;
	agentId?: string | null;
	conversationId?: string | null;
	isSubagent: boolean;
	prompt?: string | null;
	metadata?: Record<string, unknown> | null;
	hookPath?: string;
	messagesPath?: string | null;
	updatedAt: string;
}

export interface CreateRootSessionInput {
	sessionId: string;
	source: SessionSource;
	pid: number;
	startedAt: string;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	prompt?: string;
	metadata?: Record<string, unknown>;
	messagesPath: string;
}

export interface CreateRootSessionWithArtifactsInput {
	sessionId: string;
	source: SessionSource;
	pid: number;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	prompt?: string;
	metadata?: Record<string, unknown>;
	startedAt?: string;
}

export interface RootSessionArtifacts {
	manifestPath: string;
	messagesPath: string;
	manifest: SessionManifest;
}

export interface UpsertSubagentInput {
	agentId: string;
	parentAgentId: string;
	conversationId: string;
	prompt?: string;
	rootSessionId?: string;
}

/** SELECT clause that aliases snake_case columns to camelCase SessionRow keys. */
export const SESSION_SELECT_COLUMNS = `
	session_id    AS sessionId,
	source,
	pid,
	started_at    AS startedAt,
	ended_at      AS endedAt,
	exit_code     AS exitCode,
	status,
	status_lock   AS statusLock,
	interactive,
	provider,
	model,
	cwd,
	workspace_root AS workspaceRoot,
	team_name      AS teamName,
	enable_tools   AS enableTools,
	enable_spawn   AS enableSpawn,
	enable_teams   AS enableTeams,
	parent_session_id AS parentSessionId,
	parent_agent_id   AS parentAgentId,
	agent_id       AS agentId,
	conversation_id AS conversationId,
	is_subagent    AS isSubagent,
	prompt,
	metadata_json  AS metadata,
	hook_path       AS hookPath,
	messages_path   AS messagesPath,
	updated_at      AS updatedAt`;

export function patchSqliteRow(raw: Record<string, unknown>): SessionRow {
	raw.interactive = raw.interactive === 1;
	raw.enableTools = raw.enableTools === 1;
	raw.enableSpawn = raw.enableSpawn === 1;
	raw.enableTeams = raw.enableTeams === 1;
	raw.isSubagent = raw.isSubagent === 1;
	const meta = raw.metadata;
	if (typeof meta === "string" && meta.trim()) {
		try {
			const parsed = JSON.parse(meta) as unknown;
			raw.metadata =
				parsed && typeof parsed === "object" && !Array.isArray(parsed)
					? parsed
					: null;
		} catch {
			raw.metadata = null;
		}
	} else {
		raw.metadata = null;
	}
	return raw as unknown as SessionRow;
}

export function stringifyMetadata(
	metadata: Record<string, unknown> | null | undefined,
): string | null {
	if (!metadata || Object.keys(metadata).length === 0) return null;
	return JSON.stringify(metadata);
}

export type TeamRuntimeState = ReturnType<AgentTeamsRuntime["exportState"]>;

export interface PersistedTeamEnvelope {
	version: 1;
	updatedAt: string;
	teamState: TeamRuntimeState;
	teammates: TeamTeammateSpec[];
}

export function reviveTeamStateDates(
	state: TeamRuntimeState,
): TeamRuntimeState {
	return {
		...state,
		tasks: state.tasks.map((task) => ({
			...task,
			createdAt: new Date(task.createdAt),
			updatedAt: new Date(task.updatedAt),
		})),
		mailbox: state.mailbox.map((message) => ({
			...message,
			sentAt: new Date(message.sentAt),
			readAt: message.readAt ? new Date(message.readAt) : undefined,
		})),
		missionLog: state.missionLog.map((entry) => ({
			...entry,
			ts: new Date(entry.ts),
		})),
		runs: (state.runs ?? []).map((run) => ({
			...run,
			startedAt: new Date(run.startedAt),
			endedAt: run.endedAt ? new Date(run.endedAt) : undefined,
			nextAttemptAt: run.nextAttemptAt
				? new Date(run.nextAttemptAt)
				: undefined,
			heartbeatAt: run.heartbeatAt ? new Date(run.heartbeatAt) : undefined,
		})),
		outcomes: (state.outcomes ?? []).map((outcome) => ({
			...outcome,
			createdAt: new Date(outcome.createdAt),
			finalizedAt: outcome.finalizedAt
				? new Date(outcome.finalizedAt)
				: undefined,
		})),
		outcomeFragments: (state.outcomeFragments ?? []).map((fragment) => ({
			...fragment,
			createdAt: new Date(fragment.createdAt),
			reviewedAt: fragment.reviewedAt
				? new Date(fragment.reviewedAt)
				: undefined,
		})),
	};
}
