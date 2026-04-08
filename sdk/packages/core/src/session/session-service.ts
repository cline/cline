import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TeamTeammateSpec } from "@clinebot/shared";
import { resolveTeamDataDir } from "@clinebot/shared/storage";
import type { SqliteSessionStore } from "../storage/sqlite-session-store";
import type { AgentTeamsRuntime, TeamEvent } from "../team";
import type { SessionSource, SessionStatus } from "../types/common";
import { nowIso } from "./session-artifacts";
import type { SessionManifest } from "./session-manifest";
import type {
	PersistedSessionUpdateInput,
	SessionPersistenceAdapter,
} from "./unified-session-persistence-service";
import { UnifiedSessionPersistenceService } from "./unified-session-persistence-service";

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
	transcriptPath: string;
	hookPath: string;
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
	transcriptPath: string;
	hookPath: string;
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
	transcriptPath: string;
	hookPath: string;
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

// ── SQLite helpers ───────────────────────────────────────────────────

/** SELECT clause that aliases snake_case columns to camelCase SessionRow keys. */
const SESSION_SELECT_COLUMNS = `
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
	transcript_path AS transcriptPath,
	hook_path       AS hookPath,
	messages_path   AS messagesPath,
	updated_at      AS updatedAt`;

/**
 * Patch a raw SQLite result into a proper SessionRow.
 * SQLite returns 0/1 for booleans and a JSON string for metadata —
 * this converts them in-place to avoid allocating a second object.
 */
function patchSqliteRow(raw: Record<string, unknown>): SessionRow {
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

function stringifyMetadata(
	metadata: Record<string, unknown> | null | undefined,
): string | null {
	if (!metadata || Object.keys(metadata).length === 0) return null;
	return JSON.stringify(metadata);
}

function reviveTeamStateDates(state: TeamRuntimeState): TeamRuntimeState {
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

function sanitizeTeamName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

interface PersistedTeamEnvelope {
	version: 1;
	updatedAt: string;
	teamState: TeamRuntimeState;
	teammates: TeamTeammateSpec[];
}

type TeamRuntimeState = ReturnType<AgentTeamsRuntime["exportState"]>;

export interface FileTeamPersistenceStoreOptions {
	teamName: string;
	baseDir?: string;
}

export class FileTeamPersistenceStore {
	private readonly dirPath: string;
	private readonly statePath: string;
	private readonly taskHistoryPath: string;
	private readonly teammateSpecs: Map<string, TeamTeammateSpec> = new Map();

	constructor(options: FileTeamPersistenceStoreOptions) {
		const safeTeamName = sanitizeTeamName(options.teamName);
		const baseDir = options.baseDir?.trim() || resolveTeamDataDir();
		this.dirPath = join(baseDir, safeTeamName);
		this.statePath = join(this.dirPath, "state.json");
		this.taskHistoryPath = join(this.dirPath, "task-history.jsonl");
	}

	loadState(): TeamRuntimeState | undefined {
		if (!existsSync(this.statePath)) {
			return undefined;
		}
		try {
			const raw = readFileSync(this.statePath, "utf8");
			const parsed = JSON.parse(raw) as PersistedTeamEnvelope;
			if (parsed.version !== 1 || !parsed.teamState) {
				return undefined;
			}
			for (const spec of parsed.teammates ?? []) {
				this.teammateSpecs.set(spec.agentId, spec);
			}
			return reviveTeamStateDates(parsed.teamState);
		} catch {
			return undefined;
		}
	}

	getTeammateSpecs(): TeamTeammateSpec[] {
		return Array.from(this.teammateSpecs.values());
	}

	upsertTeammateSpec(spec: TeamTeammateSpec): void {
		this.teammateSpecs.set(spec.agentId, spec);
	}

	removeTeammateSpec(agentId: string): void {
		this.teammateSpecs.delete(agentId);
	}

	persist(runtime: AgentTeamsRuntime): void {
		if (!this.hasPersistableState(runtime)) {
			this.clearPersistedState();
			return;
		}
		this.ensureDir();
		const envelope: PersistedTeamEnvelope = {
			version: 1,
			updatedAt: new Date().toISOString(),
			teamState: runtime.exportState(),
			teammates: Array.from(this.teammateSpecs.values()),
		};
		const tmpPath = `${this.statePath}.tmp`;
		writeFileSync(tmpPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
		renameSync(tmpPath, this.statePath);
	}

	appendTaskHistory(event: TeamEvent): void {
		let task: Record<string, unknown> = {};
		switch (event.type) {
			case "team_task_updated":
				task = event.task as unknown as Record<string, unknown>;
				break;
			case "team_message":
				task = {
					agentId: event.message.fromAgentId,
					toAgentId: event.message.toAgentId,
					subject: event.message.subject,
					taskId: event.message.taskId,
				};
				break;
			case "team_mission_log":
				task = {
					agentId: event.entry.agentId,
					kind: event.entry.kind,
					summary: event.entry.summary,
					taskId: event.entry.taskId,
				};
				break;
			case "teammate_spawned":
			case "teammate_shutdown":
			case "task_start":
				task = {
					agentId: event.agentId,
					message: "message" in event ? event.message : undefined,
				};
				break;
			case "task_end":
				task = {
					agentId: event.agentId,
					finishReason: event.result?.finishReason,
					error: event.error?.message,
				};
				break;
			case "agent_event":
				task = {
					agentId: event.agentId,
					eventType: event.event.type,
				};
				break;
		}
		this.ensureDir();
		appendFileSync(
			this.taskHistoryPath,
			`${JSON.stringify({
				ts: new Date().toISOString(),
				type: event.type,
				task,
			})}\n`,
			"utf8",
		);
	}

	private ensureDir(): void {
		if (!existsSync(this.dirPath)) {
			mkdirSync(this.dirPath, { recursive: true });
		}
	}

	private hasPersistableState(runtime: AgentTeamsRuntime): boolean {
		const state = runtime.exportState();
		if (this.teammateSpecs.size > 0) {
			return true;
		}
		if (state.members.some((member) => member.role === "teammate")) {
			return true;
		}
		return (
			state.tasks.length > 0 ||
			state.mailbox.length > 0 ||
			state.missionLog.length > 0
		);
	}

	private clearPersistedState(): void {
		if (existsSync(this.statePath)) {
			unlinkSync(this.statePath);
		}
	}
}

class LocalSessionPersistenceAdapter implements SessionPersistenceAdapter {
	constructor(private readonly store: SqliteSessionStore) {}

	ensureSessionsDir(): string {
		return this.store.ensureSessionsDir();
	}

	async upsertSession(row: SessionRow): Promise<void> {
		this.store.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				row.sessionId,
				row.source,
				row.pid,
				row.startedAt,
				row.endedAt ?? null,
				row.exitCode ?? null,
				row.status,
				row.statusLock,
				row.interactive ? 1 : 0,
				row.provider,
				row.model,
				row.cwd,
				row.workspaceRoot,
				row.teamName ?? null,
				row.enableTools ? 1 : 0,
				row.enableSpawn ? 1 : 0,
				row.enableTeams ? 1 : 0,
				row.parentSessionId ?? null,
				row.parentAgentId ?? null,
				row.agentId ?? null,
				row.conversationId ?? null,
				row.isSubagent ? 1 : 0,
				row.prompt ?? null,
				stringifyMetadata(row.metadata),
				row.transcriptPath,
				row.hookPath,
				row.messagesPath ?? null,
				row.updatedAt,
			],
		);
	}

	async getSession(sessionId: string): Promise<SessionRow | undefined> {
		const row = this.store.queryOne<Record<string, unknown>>(
			`SELECT ${SESSION_SELECT_COLUMNS} FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		return row ? patchSqliteRow(row) : undefined;
	}

	async listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<SessionRow[]> {
		const whereClauses: string[] = [];
		const params: unknown[] = [];
		if (options.parentSessionId) {
			whereClauses.push("parent_session_id = ?");
			params.push(options.parentSessionId);
		}
		if (options.status) {
			whereClauses.push("status = ?");
			params.push(options.status);
		}
		const where =
			whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
		return this.store
			.queryAll<Record<string, unknown>>(
				`SELECT ${SESSION_SELECT_COLUMNS}
				 FROM sessions
				 ${where}
				 ORDER BY started_at DESC
				 LIMIT ?`,
				[...params, options.limit],
			)
			.map(patchSqliteRow);
	}

	async updateSession(
		input: PersistedSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		if (input.setRunning) {
			if (input.expectedStatusLock === undefined) {
				return { updated: false, statusLock: 0 };
			}
			const changed = this.store.run(
				`UPDATE sessions
				 SET status = 'running', ended_at = NULL, exit_code = NULL, updated_at = ?, status_lock = ?,
					 parent_session_id = ?, parent_agent_id = ?, agent_id = ?, conversation_id = ?, is_subagent = 1,
					 prompt = COALESCE(prompt, ?)
				 WHERE session_id = ? AND status_lock = ?`,
				[
					nowIso(),
					input.expectedStatusLock + 1,
					input.parentSessionId ?? null,
					input.parentAgentId ?? null,
					input.agentId ?? null,
					input.conversationId ?? null,
					input.prompt ?? null,
					input.sessionId,
					input.expectedStatusLock,
				],
			);
			return {
				updated: (changed.changes ?? 0) > 0,
				statusLock: input.expectedStatusLock + 1,
			};
		}

		const fields: string[] = [];
		const params: unknown[] = [];
		if (input.status !== undefined) {
			fields.push("status = ?");
			params.push(input.status);
		}
		if (input.endedAt !== undefined) {
			fields.push("ended_at = ?");
			params.push(input.endedAt);
		}
		if (input.exitCode !== undefined) {
			fields.push("exit_code = ?");
			params.push(input.exitCode);
		}
		if (input.prompt !== undefined) {
			fields.push("prompt = ?");
			params.push(input.prompt ?? null);
		}
		if (input.metadata !== undefined) {
			fields.push("metadata_json = ?");
			params.push(stringifyMetadata(input.metadata));
		}
		if (input.parentSessionId !== undefined) {
			fields.push("parent_session_id = ?");
			params.push(input.parentSessionId ?? null);
		}
		if (input.parentAgentId !== undefined) {
			fields.push("parent_agent_id = ?");
			params.push(input.parentAgentId ?? null);
		}
		if (input.agentId !== undefined) {
			fields.push("agent_id = ?");
			params.push(input.agentId ?? null);
		}
		if (input.conversationId !== undefined) {
			fields.push("conversation_id = ?");
			params.push(input.conversationId ?? null);
		}
		if (fields.length === 0) {
			const row = await this.getSession(input.sessionId);
			return { updated: !!row, statusLock: row?.statusLock ?? 0 };
		}

		let statusLock = 0;
		if (input.expectedStatusLock !== undefined) {
			statusLock = input.expectedStatusLock + 1;
			fields.push("status_lock = ?");
			params.push(statusLock);
		}
		fields.push("updated_at = ?");
		params.push(nowIso());

		let sql = `UPDATE sessions SET ${fields.join(", ")} WHERE session_id = ?`;
		params.push(input.sessionId);
		if (input.expectedStatusLock !== undefined) {
			sql += " AND status_lock = ?";
			params.push(input.expectedStatusLock);
		}
		const changed = this.store.run(sql, params);
		if ((changed.changes ?? 0) === 0) {
			return { updated: false, statusLock: 0 };
		}
		if (input.expectedStatusLock === undefined) {
			const row = await this.getSession(input.sessionId);
			statusLock = row?.statusLock ?? 0;
		}
		return { updated: true, statusLock };
	}

	async deleteSession(sessionId: string, cascade: boolean): Promise<boolean> {
		const changed =
			this.store.run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId])
				.changes ?? 0;
		if (cascade) {
			this.store.run(`DELETE FROM sessions WHERE parent_session_id = ?`, [
				sessionId,
			]);
		}
		return changed > 0;
	}

	async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		this.store.run(
			`INSERT INTO subagent_spawn_queue (root_session_id, parent_agent_id, task, system_prompt, created_at, consumed_at)
			 VALUES (?, ?, ?, ?, ?, NULL)`,
			[
				input.rootSessionId,
				input.parentAgentId,
				input.task ?? null,
				input.systemPrompt ?? null,
				nowIso(),
			],
		);
	}

	async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		const row = this.store.queryOne<{ id?: number; task?: string | null }>(
			`SELECT id, task FROM subagent_spawn_queue
			 WHERE root_session_id = ? AND parent_agent_id = ? AND consumed_at IS NULL
			 ORDER BY id ASC LIMIT 1`,
			[rootSessionId, parentAgentId],
		);
		if (!row || typeof row.id !== "number") {
			return undefined;
		}
		this.store.run(
			`UPDATE subagent_spawn_queue SET consumed_at = ? WHERE id = ?`,
			[nowIso(), row.id],
		);
		return row.task ?? undefined;
	}
}

export class CoreSessionService extends UnifiedSessionPersistenceService {
	constructor(private readonly store: SqliteSessionStore) {
		super(new LocalSessionPersistenceAdapter(store));
	}

	createRootSession(input: CreateRootSessionInput): void {
		this.store.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				input.sessionId,
				input.source,
				input.pid,
				input.startedAt,
				null,
				null,
				"running",
				0,
				input.interactive ? 1 : 0,
				input.provider,
				input.model,
				input.cwd,
				input.workspaceRoot,
				input.teamName ?? null,
				input.enableTools ? 1 : 0,
				input.enableSpawn ? 1 : 0,
				input.enableTeams ? 1 : 0,
				null,
				null,
				null,
				null,
				0,
				input.prompt ?? null,
				input.metadata ? JSON.stringify(input.metadata) : null,
				input.transcriptPath,
				input.hookPath,
				input.messagesPath,
				nowIso(),
			],
		);
	}
}
