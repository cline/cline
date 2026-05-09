import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	asBool,
	asOptionalString,
	asString,
	ensureSessionSchema,
	loadSqliteDb,
	nowIso,
	type SqliteDb,
	toBoolInt,
} from "@clinebot/shared/db";
import { resolveDbDataDir } from "@clinebot/shared/storage";
import type { SessionStatus } from "../../types/common";
import type { SessionRecord } from "../../types/sessions";
import type { SessionStore } from "../../types/storage";

export interface SqliteSessionStoreOptions {
	sessionsDir?: string;
}

export class SqliteSessionStore implements SessionStore {
	private readonly sessionsDirPath: string;
	private db: SqliteDb | undefined;

	constructor(options: SqliteSessionStoreOptions = {}) {
		this.sessionsDirPath = options.sessionsDir ?? resolveDbDataDir();
	}

	init(): void {
		this.getRawDb();
	}

	ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	sessionDbPath(): string {
		return join(this.ensureSessionsDir(), "sessions.db");
	}

	getRawDb(): SqliteDb {
		if (this.db) {
			return this.db;
		}
		const db = loadSqliteDb(this.sessionDbPath());
		ensureSessionSchema(db, { includeLegacyMigrations: true });

		this.db = db;
		return db;
	}

	close(): void {
		this.db?.close?.();
		this.db = undefined;
	}

	run(sql: string, params: unknown[] = []): { changes?: number } {
		return this.getRawDb()
			.prepare(sql)
			.run(...params);
	}

	queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
		const row = this.getRawDb()
			.prepare(sql)
			.get(...params);
		return (row as T | null) ?? undefined;
	}

	queryAll<T>(sql: string, params: unknown[] = []): T[] {
		return this.getRawDb()
			.prepare(sql)
			.all(...params) as T[];
	}

	create(record: SessionRecord): void {
		const now = nowIso();
		this.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				metadata_json, transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				record.sessionId,
				record.source,
				record.pid,
				record.startedAt,
				record.endedAt ?? null,
				record.exitCode ?? null,
				record.status,
				0,
				toBoolInt(record.interactive),
				record.provider,
				record.model,
				record.cwd,
				record.workspaceRoot,
				record.teamName ?? null,
				toBoolInt(record.enableTools),
				toBoolInt(record.enableSpawn),
				toBoolInt(record.enableTeams),
				record.parentSessionId ?? null,
				record.parentAgentId ?? null,
				record.agentId ?? null,
				record.conversationId ?? null,
				toBoolInt(record.isSubagent),
				record.prompt ?? null,
				record.metadata ? JSON.stringify(record.metadata) : null,
				"",
				record.hookPath ?? "",
				record.messagesPath ?? null,
				now,
			],
		);
	}

	update(record: Partial<SessionRecord> & { sessionId: string }): void {
		const fields: string[] = [];
		const params: unknown[] = [];
		if (record.endedAt !== undefined) {
			fields.push("ended_at = ?");
			params.push(record.endedAt);
		}
		if (record.exitCode !== undefined) {
			fields.push("exit_code = ?");
			params.push(record.exitCode);
		}
		if (record.status !== undefined) {
			fields.push("status = ?");
			params.push(record.status);
		}
		if (record.prompt !== undefined) {
			fields.push("prompt = ?");
			params.push(record.prompt);
		}
		if (record.metadata !== undefined) {
			fields.push("metadata_json = ?");
			params.push(record.metadata ? JSON.stringify(record.metadata) : null);
		}
		if (record.parentSessionId !== undefined) {
			fields.push("parent_session_id = ?");
			params.push(record.parentSessionId);
		}
		if (record.parentAgentId !== undefined) {
			fields.push("parent_agent_id = ?");
			params.push(record.parentAgentId);
		}
		if (record.agentId !== undefined) {
			fields.push("agent_id = ?");
			params.push(record.agentId);
		}
		if (record.conversationId !== undefined) {
			fields.push("conversation_id = ?");
			params.push(record.conversationId);
		}
		if (fields.length === 0) {
			return;
		}
		fields.push("updated_at = ?");
		params.push(nowIso());
		params.push(record.sessionId);
		this.run(
			`UPDATE sessions SET ${fields.join(", ")} WHERE session_id = ?`,
			params,
		);
	}

	updateStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): void {
		this.update({
			sessionId,
			status,
			endedAt: status === "running" ? null : nowIso(),
			exitCode:
				status === "running"
					? null
					: (exitCode ?? (status === "failed" ? 1 : 0)),
		});
	}

	get(sessionId: string): SessionRecord | undefined {
		const row = this.queryOne<Record<string, unknown>>(
			`SELECT session_id, source, pid, started_at, ended_at, exit_code, status, interactive,
				provider, model, cwd, workspace_root, team_name,
				enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent,
				prompt, metadata_json, hook_path, messages_path, updated_at
			 FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		if (!row) {
			return undefined;
		}
		return {
			sessionId: asString(row.session_id),
			source: asString(row.source) as SessionRecord["source"],
			pid: Number(row.pid ?? 0),
			startedAt: asString(row.started_at),
			endedAt: (row.ended_at as string | null | undefined) ?? null,
			exitCode: (row.exit_code as number | null | undefined) ?? null,
			status: asString(row.status) as SessionRecord["status"],
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
			hookPath: asOptionalString(row.hook_path),
			messagesPath: asOptionalString(row.messages_path),
			updatedAt: asOptionalString(row.updated_at) ?? nowIso(),
		};
	}

	list(limit = 200): SessionRecord[] {
		const rows = this.queryAll<Record<string, unknown>>(
			`SELECT session_id FROM sessions ORDER BY started_at DESC LIMIT ?`,
			[limit],
		);
		const result: SessionRecord[] = [];
		for (const row of rows) {
			const item = this.get(asString(row.session_id));
			if (item) {
				result.push(item);
			}
		}
		return result;
	}

	delete(sessionId: string, cascade = false): boolean {
		const changed =
			this.run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId])
				.changes ?? 0;
		if (cascade) {
			this.run(`DELETE FROM sessions WHERE parent_session_id = ?`, [sessionId]);
		}
		return changed > 0;
	}
}
