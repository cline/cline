import type {
	RpcSessionBackend,
	RpcSessionRow,
	RpcSessionStatus,
	RpcSessionUpdateInput,
	RpcSpawnQueueItem,
} from "@clinebot/rpc";
import {
	asBool,
	asOptionalString,
	asString,
	nowIso,
	toBoolInt,
} from "@clinebot/shared/db";
import { SqliteSessionStore } from "../storage/sqlite-session-store";

export interface SqliteRpcSessionBackendOptions {
	sessionsDir?: string;
}

export class SqliteRpcSessionBackend implements RpcSessionBackend {
	private readonly store: SqliteSessionStore;

	constructor(options: SqliteRpcSessionBackendOptions = {}) {
		this.store = new SqliteSessionStore({ sessionsDir: options.sessionsDir });
	}

	public init(): void {
		this.store.init();
	}

	public upsertSession(row: RpcSessionRow): void {
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
				toBoolInt(row.interactive),
				row.provider,
				row.model,
				row.cwd,
				row.workspaceRoot,
				row.teamName ?? null,
				toBoolInt(row.enableTools),
				toBoolInt(row.enableSpawn),
				toBoolInt(row.enableTeams),
				row.parentSessionId ?? null,
				row.parentAgentId ?? null,
				row.agentId ?? null,
				row.conversationId ?? null,
				toBoolInt(row.isSubagent),
				row.prompt ?? null,
				row.metadata ? JSON.stringify(row.metadata) : null,
				row.transcriptPath,
				"",
				row.messagesPath ?? null,
				row.updatedAt || nowIso(),
			],
		);
	}

	public getSession(sessionId: string): RpcSessionRow | undefined {
		const row = this.store.queryOne<Record<string, unknown>>(
			`SELECT session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, transcript_path, hook_path, messages_path, updated_at
			 FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		if (!row) {
			return undefined;
		}
		return {
			sessionId: asString(row.session_id),
			source: asString(row.source),
			pid: Number(row.pid ?? 0),
			startedAt: asString(row.started_at),
			endedAt: (row.ended_at as string | null | undefined) ?? null,
			exitCode: (row.exit_code as number | null | undefined) ?? null,
			status: asString(row.status) as RpcSessionStatus,
			statusLock: Number(row.status_lock ?? 0),
			interactive: asBool(row.interactive),
			provider: asString(row.provider),
			model: asString(row.model),
			cwd: asString(row.cwd),
			workspaceRoot: asString(row.workspace_root),
			teamName: asOptionalString(row.team_name),
			enableTools: asBool(row.enable_tools),
			enableSpawn: asBool(row.enable_spawn),
			enableTeams: asBool(row.enable_teams),
			parentSessionId: asOptionalString(row.parent_session_id),
			parentAgentId: asOptionalString(row.parent_agent_id),
			agentId: asOptionalString(row.agent_id),
			conversationId: asOptionalString(row.conversation_id),
			isSubagent: asBool(row.is_subagent),
			prompt: asOptionalString(row.prompt),
			metadata: (() => {
				const raw = asOptionalString(row.metadata_json);
				if (!raw) {
					return undefined;
				}
				try {
					const parsed = JSON.parse(raw) as unknown;
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						return parsed as Record<string, unknown>;
					}
				} catch {
					// Ignore malformed metadata payloads.
				}
				return undefined;
			})(),
			transcriptPath: asString(row.transcript_path),
			messagesPath: asOptionalString(row.messages_path),
			updatedAt: asString(row.updated_at) || nowIso(),
		};
	}

	public listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): RpcSessionRow[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (options.parentSessionId) {
			where.push("parent_session_id = ?");
			params.push(options.parentSessionId);
		}
		if (options.status) {
			where.push("status = ?");
			params.push(options.status);
		}
		const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const limit = Math.max(1, Math.floor(options.limit));
		const rows = this.store.queryAll<{ session_id?: string }>(
			`SELECT session_id FROM sessions ${whereClause} ORDER BY started_at DESC LIMIT ?`,
			[...params, limit],
		);
		const out: RpcSessionRow[] = [];
		for (const row of rows) {
			if (!row.session_id) {
				continue;
			}
			const item = this.getSession(row.session_id);
			if (item) {
				out.push(item);
			}
		}
		return out;
	}

	public updateSession(input: RpcSessionUpdateInput): {
		updated: boolean;
		statusLock: number;
	} {
		const existing = this.getSession(input.sessionId);
		if (!existing) {
			return { updated: false, statusLock: 0 };
		}
		if (
			typeof input.expectedStatusLock === "number" &&
			existing.statusLock !== input.expectedStatusLock
		) {
			return { updated: false, statusLock: existing.statusLock };
		}
		const nextLock = existing.statusLock + 1;
		const nextStatus = input.setRunning
			? "running"
			: (input.status ?? existing.status);
		const nextEndedAt =
			input.setRunning === true
				? null
				: input.endedAt !== undefined
					? input.endedAt
					: (existing.endedAt ?? null);
		const nextExitCode =
			input.setRunning === true
				? null
				: input.exitCode !== undefined
					? input.exitCode
					: (existing.exitCode ?? null);
		const nextPrompt =
			input.prompt !== undefined
				? (input.prompt ?? undefined)
				: existing.prompt;
		const nextMetadata =
			input.metadata !== undefined
				? (input.metadata ?? undefined)
				: existing.metadata;

		this.store.run(
			`UPDATE sessions
			 SET status = ?, ended_at = ?, exit_code = ?, prompt = ?, metadata_json = ?,
				 parent_session_id = ?, parent_agent_id = ?, agent_id = ?, conversation_id = ?,
				 status_lock = ?, updated_at = ?
			 WHERE session_id = ?`,
			[
				nextStatus,
				nextEndedAt,
				nextExitCode,
				nextPrompt ?? null,
				nextMetadata ? JSON.stringify(nextMetadata) : null,
				input.parentSessionId !== undefined
					? (input.parentSessionId ?? null)
					: (existing.parentSessionId ?? null),
				input.parentAgentId !== undefined
					? (input.parentAgentId ?? null)
					: (existing.parentAgentId ?? null),
				input.agentId !== undefined
					? (input.agentId ?? null)
					: (existing.agentId ?? null),
				input.conversationId !== undefined
					? (input.conversationId ?? null)
					: (existing.conversationId ?? null),
				nextLock,
				nowIso(),
				input.sessionId,
			],
		);
		return { updated: true, statusLock: nextLock };
	}

	public deleteSession(sessionId: string): boolean {
		const changes =
			this.store.run("DELETE FROM sessions WHERE session_id = ?", [sessionId])
				.changes ?? 0;
		return changes > 0;
	}

	public deleteSessionsByParent(parentSessionId: string): void {
		this.store.run("DELETE FROM sessions WHERE parent_session_id = ?", [
			parentSessionId,
		]);
	}

	public enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): void {
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

	public claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): RpcSpawnQueueItem | undefined {
		const row = this.store.queryOne<Record<string, unknown>>(
			`SELECT id, root_session_id, parent_agent_id, task, system_prompt, created_at, consumed_at
			 FROM subagent_spawn_queue
			 WHERE root_session_id = ? AND parent_agent_id = ? AND consumed_at IS NULL
			 ORDER BY id ASC LIMIT 1`,
			[rootSessionId, parentAgentId],
		);
		if (!row || typeof row.id !== "number") {
			return undefined;
		}
		const consumedAt = nowIso();
		this.store.run(
			"UPDATE subagent_spawn_queue SET consumed_at = ? WHERE id = ?",
			[consumedAt, row.id],
		);
		return {
			id: row.id,
			rootSessionId: asString(row.root_session_id),
			parentAgentId: asString(row.parent_agent_id),
			task: asOptionalString(row.task),
			systemPrompt: asOptionalString(row.system_prompt),
			createdAt: asString(row.created_at),
			consumedAt,
		};
	}
}

export function createSqliteRpcSessionBackend(
	options: SqliteRpcSessionBackendOptions = {},
): RpcSessionBackend {
	return new SqliteRpcSessionBackend(options);
}
