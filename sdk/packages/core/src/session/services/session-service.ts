import { existsSync, mkdirSync } from "node:fs";
import { resolveSessionDataDir } from "@clinebot/shared/storage";
import { nowIso } from "../../services/session-artifacts";
import type { SqliteSessionStore } from "../../services/storage/sqlite-session-store";
import type { SessionMessagesArtifactUploader } from "../../types/session";
import {
	type CreateRootSessionInput,
	patchSqliteRow,
	SESSION_SELECT_COLUMNS,
	type SessionRow,
	stringifyMetadata,
} from "../models/session-row";
import type {
	PersistedSessionUpdateInput,
	SessionPersistenceAdapter,
} from "./persistence-service";
import { UnifiedSessionPersistenceService } from "./persistence-service";

class LocalSessionPersistenceAdapter implements SessionPersistenceAdapter {
	constructor(
		private readonly store: SqliteSessionStore,
		private readonly sessionsDirPath: string = resolveSessionDataDir(),
	) {}

	ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
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
				"",
				row.hookPath ?? "",
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
	constructor(
		private readonly store: SqliteSessionStore,
		options: {
			sessionArtifactsDir?: string;
			messagesArtifactUploader?: SessionMessagesArtifactUploader;
		} = {},
	) {
		super(
			new LocalSessionPersistenceAdapter(store, options.sessionArtifactsDir),
			options,
		);
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
				"",
				"",
				input.messagesPath,
				nowIso(),
			],
		);
	}
}

export type {
	CreateRootSessionInput,
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
	SessionRow,
	UpsertSubagentInput,
} from "../models/session-row";
