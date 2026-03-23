import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

export type SqliteStatement = {
	run: (...params: unknown[]) => { changes?: number };
	get: (...params: unknown[]) => Record<string, unknown> | null;
	all: (...params: unknown[]) => Record<string, unknown>[];
};

export type SqliteDb = {
	prepare: (sql: string) => SqliteStatement;
	exec: (sql: string) => void;
};

type BunSqliteDb = {
	query: (sql: string) => {
		run: (...params: unknown[]) => { changes?: number };
		get: (...params: unknown[]) => Record<string, unknown> | null;
		all: (...params: unknown[]) => Record<string, unknown>[];
	};
	exec: (sql: string) => void;
};

type NodeSqliteStatement = {
	run: (...params: unknown[]) => { changes?: number };
	get: (...params: unknown[]) => Record<string, unknown> | undefined;
	all: (...params: unknown[]) => Record<string, unknown>[];
};

type NodeSqliteDb = {
	prepare: (sql: string) => NodeSqliteStatement;
	exec: (sql: string) => void;
};

export function nowIso(): string {
	return new Date().toISOString();
}

export function toBoolInt(value: boolean): number {
	return value ? 1 : 0;
}

export function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function asOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function asBool(value: unknown): boolean {
	return value === 1 || value === true;
}

export function loadSqliteDb(filePath: string): SqliteDb {
	mkdirSync(dirname(filePath), { recursive: true });
	const require = createRequire(import.meta.url);
	const isBunRuntime =
		typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

	if (isBunRuntime) {
		const { Database } = require("bun:sqlite") as {
			Database: new (
				path: string,
				options?: { create?: boolean; strict?: boolean },
			) => BunSqliteDb;
		};
		const db = new Database(filePath, { create: true });

		return {
			prepare: (sql: string): SqliteStatement => {
				const query = db.query(sql);
				return {
					run: (...params: unknown[]) => query.run(...params),
					get: (...params: unknown[]) => query.get(...params),
					all: (...params: unknown[]) => query.all(...params),
				};
			},
			exec: (sql: string) => db.exec(sql),
		};
	}

	try {
		const nodeSqliteModuleName = ["node", ":sqlite"].join("");
		const { DatabaseSync } = require(nodeSqliteModuleName) as {
			DatabaseSync: new (path: string) => NodeSqliteDb;
		};
		const db = new DatabaseSync(filePath);
		return {
			prepare: (sql: string): SqliteStatement => {
				const statement = db.prepare(sql);
				return {
					run: (...params: unknown[]) => statement.run(...params),
					get: (...params: unknown[]) => statement.get(...params) ?? null,
					all: (...params: unknown[]) => statement.all(...params),
				};
			},
			exec: (sql: string) => db.exec(sql),
		};
	} catch {
		// Fall through to better-sqlite3 for older Node runtimes without node:sqlite.
	}

	// Keep the module name non-literal so browser/SSR bundlers don't try to resolve
	// better-sqlite3 when this Node-only path is not executed.
	const betterSqlite3ModuleName = ["better", "-sqlite3"].join("");
	const BetterSqlite3 = require(betterSqlite3ModuleName) as new (
		path: string,
	) => SqliteDb;
	return new BetterSqlite3(filePath);
}

export interface SessionSchemaOptions {
	includeLegacyMigrations?: boolean;
}

export function ensureSessionSchema(
	db: SqliteDb,
	options: SessionSchemaOptions = {},
): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			session_id TEXT PRIMARY KEY,
			source TEXT NOT NULL,
			pid INTEGER NOT NULL,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			exit_code INTEGER,
			status TEXT NOT NULL,
			status_lock INTEGER NOT NULL DEFAULT 0,
			interactive INTEGER NOT NULL,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			cwd TEXT NOT NULL,
			workspace_root TEXT NOT NULL,
			team_name TEXT,
			enable_tools INTEGER NOT NULL,
			enable_spawn INTEGER NOT NULL,
			enable_teams INTEGER NOT NULL,
			parent_session_id TEXT,
			parent_agent_id TEXT,
			agent_id TEXT,
			conversation_id TEXT,
			is_subagent INTEGER NOT NULL DEFAULT 0,
			prompt TEXT,
			metadata_json TEXT,
			transcript_path TEXT NOT NULL,
			hook_path TEXT NOT NULL,
			messages_path TEXT,
			updated_at TEXT NOT NULL
		);
	`);
	db.exec(`
		CREATE TABLE IF NOT EXISTS subagent_spawn_queue (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			root_session_id TEXT NOT NULL,
			parent_agent_id TEXT NOT NULL,
			task TEXT,
			system_prompt TEXT,
			created_at TEXT NOT NULL,
			consumed_at TEXT
		);
	`);
	db.exec(`
		CREATE TABLE IF NOT EXISTS schedules (
			schedule_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			cron_pattern TEXT NOT NULL,
			prompt TEXT NOT NULL,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			mode TEXT NOT NULL DEFAULT 'act',
			workspace_root TEXT,
			cwd TEXT,
			system_prompt TEXT,
			max_iterations INTEGER,
			timeout_seconds INTEGER,
			max_parallel INTEGER NOT NULL DEFAULT 1,
			enabled INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_run_at TEXT,
			next_run_at TEXT,
			claim_token TEXT,
			claim_started_at TEXT,
			claim_until_at TEXT,
			created_by TEXT,
			tags TEXT,
			metadata_json TEXT
		);
	`);
	db.exec(`
		CREATE TABLE IF NOT EXISTS schedule_executions (
			execution_id TEXT PRIMARY KEY,
			schedule_id TEXT NOT NULL,
			session_id TEXT,
			triggered_at TEXT NOT NULL,
			started_at TEXT,
			ended_at TEXT,
			status TEXT NOT NULL,
			exit_code INTEGER,
			error_message TEXT,
			iterations INTEGER,
			tokens_used INTEGER,
			cost_usd REAL,
			FOREIGN KEY (schedule_id) REFERENCES schedules(schedule_id) ON DELETE CASCADE,
			FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE SET NULL
		);
	`);
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule
		ON schedule_executions(schedule_id, triggered_at DESC);
	`);
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_schedules_next_run
		ON schedules(enabled, next_run_at);
	`);

	if (!options.includeLegacyMigrations) {
		return;
	}

	const columns = db.prepare("PRAGMA table_info(sessions);").all();
	const hasColumn = (name: string): boolean =>
		columns.some((column) => column.name === name);
	if (!hasColumn("workspace_root")) {
		db.exec("ALTER TABLE sessions ADD COLUMN workspace_root TEXT;");
		db.exec(
			"UPDATE sessions SET workspace_root = cwd WHERE workspace_root IS NULL OR workspace_root = '';",
		);
	}
	if (!hasColumn("parent_session_id")) {
		db.exec("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;");
	}
	if (!hasColumn("parent_agent_id")) {
		db.exec("ALTER TABLE sessions ADD COLUMN parent_agent_id TEXT;");
	}
	if (!hasColumn("agent_id")) {
		db.exec("ALTER TABLE sessions ADD COLUMN agent_id TEXT;");
	}
	if (!hasColumn("conversation_id")) {
		db.exec("ALTER TABLE sessions ADD COLUMN conversation_id TEXT;");
	}
	if (!hasColumn("is_subagent")) {
		db.exec(
			"ALTER TABLE sessions ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;",
		);
	}
	if (!hasColumn("messages_path")) {
		db.exec("ALTER TABLE sessions ADD COLUMN messages_path TEXT;");
	}
	if (!hasColumn("metadata_json")) {
		db.exec("ALTER TABLE sessions ADD COLUMN metadata_json TEXT;");
	}
	const scheduleColumns = db.prepare("PRAGMA table_info(schedules);").all();
	const scheduleHasColumn = (name: string): boolean =>
		scheduleColumns.some((column) => column.name === name);
	if (!scheduleHasColumn("claim_token")) {
		db.exec("ALTER TABLE schedules ADD COLUMN claim_token TEXT;");
	}
	if (!scheduleHasColumn("claim_started_at")) {
		db.exec("ALTER TABLE schedules ADD COLUMN claim_started_at TEXT;");
	}
	if (!scheduleHasColumn("claim_until_at")) {
		db.exec("ALTER TABLE schedules ADD COLUMN claim_until_at TEXT;");
	}
}
