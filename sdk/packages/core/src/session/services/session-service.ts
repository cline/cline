import { existsSync, mkdirSync } from "node:fs";
import type { BasicLogger } from "@cline/shared";
import {
	resolveHierarchicalWorkspaceSync,
	resolveSessionDataDir,
} from "@cline/shared/storage";
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
		let anchorWorkspacePath = row.anchorWorkspacePath;
		if (!anchorWorkspacePath) {
			const target = row.cwd || row.workspaceRoot;
			if (target) {
				try {
					anchorWorkspacePath =
						resolveHierarchicalWorkspaceSync(target).primaryRoot;
				} catch {
					anchorWorkspacePath = row.workspaceRoot || row.cwd;
				}
			} else {
				anchorWorkspacePath = row.workspaceRoot || row.cwd;
			}
		}
		this.store.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, transcript_path, hook_path, messages_path, updated_at, anchor_workspace_path
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				anchorWorkspacePath ?? null,
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
		rootOnly?: boolean;
		anchorPath?: string;
		scope?: "current" | "hierarchical" | "all";
		offset?: number;
	}): Promise<SessionRow[]> {
		const whereClauses: string[] = [];
		const params: unknown[] = [];
		if (options.parentSessionId) {
			whereClauses.push("parent_session_id = ?");
			params.push(options.parentSessionId);
		}
		if (options.rootOnly) {
			whereClauses.push(
				"is_subagent = 0 AND (parent_session_id IS NULL OR parent_session_id = '')",
			);
		}
		if (options.status) {
			whereClauses.push("status = ?");
			params.push(options.status);
		}
		if (options.anchorPath && options.scope && options.scope !== "all") {
			const normalizedAnchor = options.anchorPath
				.replace(/\\/g, "/")
				.replace(/\/+$/, "");
			if (options.scope === "current") {
				whereClauses.push(
					"(anchor_workspace_path = ? OR (anchor_workspace_path IS NULL AND (workspace_root = ? OR cwd = ?)))",
				);
				params.push(normalizedAnchor, normalizedAnchor, normalizedAnchor);
			} else if (options.scope === "hierarchical") {
				const prefix = `${normalizedAnchor}/%`;
				whereClauses.push(
					"(anchor_workspace_path = ? OR anchor_workspace_path LIKE ? OR (anchor_workspace_path IS NULL AND (workspace_root = ? OR workspace_root LIKE ? OR cwd = ? OR cwd LIKE ?)))",
				);
				params.push(
					normalizedAnchor,
					prefix,
					normalizedAnchor,
					prefix,
					normalizedAnchor,
					prefix,
				);
			}
		}
		const where =
			whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
		const offsetClause =
			options.offset !== undefined && options.offset > 0
				? ` OFFSET ${Math.floor(options.offset)}`
				: "";
		return this.store
			.queryAll<Record<string, unknown>>(
				`SELECT ${SESSION_SELECT_COLUMNS}
				 FROM sessions
				 ${where}
				 ORDER BY started_at DESC
				 LIMIT ?${offsetClause}`,
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
					 prompt = COALESCE(prompt, ?), metadata_json = ?
				 WHERE session_id = ? AND status_lock = ?`,
				[
					nowIso(),
					input.expectedStatusLock + 1,
					input.parentSessionId ?? null,
					input.parentAgentId ?? null,
					input.agentId ?? null,
					input.conversationId ?? null,
					input.prompt ?? null,
					stringifyMetadata(input.metadata),
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
			logger?: BasicLogger;
		} = {},
	) {
		super(
			new LocalSessionPersistenceAdapter(store, options.sessionArtifactsDir),
			options,
		);
	}

	createRootSession(input: CreateRootSessionInput): void {
		let anchorWorkspacePath = input.anchorWorkspacePath;
		if (!anchorWorkspacePath) {
			const target = input.cwd || input.workspaceRoot;
			if (target) {
				try {
					anchorWorkspacePath =
						resolveHierarchicalWorkspaceSync(target).primaryRoot;
				} catch {
					anchorWorkspacePath = input.workspaceRoot || input.cwd;
				}
			} else {
				anchorWorkspacePath = input.workspaceRoot || input.cwd;
			}
		}
		this.store.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, transcript_path, hook_path, messages_path, updated_at, anchor_workspace_path
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				anchorWorkspacePath ?? null,
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
