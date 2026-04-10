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
	close?: () => void;
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
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function asBool(value: unknown): boolean {
	return value === 1 || value === true;
}

function wrapBunDb(db: {
	query: (sql: string) => SqliteStatement;
	exec: (sql: string) => void;
	close?: () => void;
}): SqliteDb {
	return {
		prepare: (sql) => db.query(sql),
		exec: (sql) => db.exec(sql),
		close: () => db.close?.(),
	};
}

function wrapNodeDb(db: {
	prepare: (sql: string) => {
		run: (...params: unknown[]) => { changes?: number };
		get: (...params: unknown[]) => Record<string, unknown> | undefined;
		all: (...params: unknown[]) => Record<string, unknown>[];
	};
	exec: (sql: string) => void;
	close?: () => void;
}): SqliteDb {
	return {
		prepare: (sql) => {
			const stmt = db.prepare(sql);
			return {
				run: (...params) => stmt.run(...params),
				get: (...params) => stmt.get(...params) ?? null,
				all: (...params) => stmt.all(...params),
			};
		},
		exec: (sql) => db.exec(sql),
		close: () => db.close?.(),
	};
}

export function loadSqliteDb(filePath: string): SqliteDb {
	mkdirSync(dirname(filePath), { recursive: true });
	const require = createRequire(import.meta.url);

	if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
		const { Database } = require("bun:sqlite") as {
			Database: new (
				path: string,
				options?: { create?: boolean },
			) => {
				query: (sql: string) => SqliteStatement;
				exec: (sql: string) => void;
				close?: () => void;
			};
		};
		return wrapBunDb(new Database(filePath, { create: true }));
	}

	// Suppress "ExperimentalWarning: SQLite is an experimental feature"
	const originalEmit = process.emitWarning;
	process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
		const msg =
			typeof warning === "string" ? warning : (warning?.message ?? "");
		if (msg.includes("SQLite")) return;
		return (originalEmit as Function).call(process, warning, ...args);
	}) as typeof process.emitWarning;

	try {
		const { DatabaseSync } = require(["node", ":sqlite"].join("")) as {
			DatabaseSync: new (
				path: string,
			) => {
				prepare: (sql: string) => {
					run: (...params: unknown[]) => { changes?: number };
					get: (...params: unknown[]) => Record<string, unknown> | undefined;
					all: (...params: unknown[]) => Record<string, unknown>[];
				};
				exec: (sql: string) => void;
				close?: () => void;
			};
		};
		return wrapNodeDb(new DatabaseSync(filePath));
	} finally {
		process.emitWarning = originalEmit;
	}
}

export interface SessionSchemaOptions {
	includeLegacyMigrations?: boolean;
}

const SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS sessions (
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
	);`,
	`CREATE TABLE IF NOT EXISTS subagent_spawn_queue (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		root_session_id TEXT NOT NULL,
		parent_agent_id TEXT NOT NULL,
		task TEXT,
		system_prompt TEXT,
		created_at TEXT NOT NULL,
		consumed_at TEXT
	);`,
	`CREATE TABLE IF NOT EXISTS schedules (
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
	);`,
	`CREATE TABLE IF NOT EXISTS schedule_executions (
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
	);`,
	`CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule
	ON schedule_executions(schedule_id, triggered_at DESC);`,
	`CREATE INDEX IF NOT EXISTS idx_schedules_next_run
	ON schedules(enabled, next_run_at);`,
];

const LEGACY_MIGRATIONS: Array<{
	table: string;
	column: string;
	sql: string;
}> = [
	{
		table: "sessions",
		column: "workspace_root",
		sql: "ALTER TABLE sessions ADD COLUMN workspace_root TEXT;",
	},
	{
		table: "sessions",
		column: "parent_session_id",
		sql: "ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;",
	},
	{
		table: "sessions",
		column: "parent_agent_id",
		sql: "ALTER TABLE sessions ADD COLUMN parent_agent_id TEXT;",
	},
	{
		table: "sessions",
		column: "agent_id",
		sql: "ALTER TABLE sessions ADD COLUMN agent_id TEXT;",
	},
	{
		table: "sessions",
		column: "conversation_id",
		sql: "ALTER TABLE sessions ADD COLUMN conversation_id TEXT;",
	},
	{
		table: "sessions",
		column: "is_subagent",
		sql: "ALTER TABLE sessions ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;",
	},
	{
		table: "sessions",
		column: "messages_path",
		sql: "ALTER TABLE sessions ADD COLUMN messages_path TEXT;",
	},
	{
		table: "sessions",
		column: "metadata_json",
		sql: "ALTER TABLE sessions ADD COLUMN metadata_json TEXT;",
	},
	{
		table: "schedules",
		column: "claim_token",
		sql: "ALTER TABLE schedules ADD COLUMN claim_token TEXT;",
	},
	{
		table: "schedules",
		column: "claim_started_at",
		sql: "ALTER TABLE schedules ADD COLUMN claim_started_at TEXT;",
	},
	{
		table: "schedules",
		column: "claim_until_at",
		sql: "ALTER TABLE schedules ADD COLUMN claim_until_at TEXT;",
	},
];

function getColumnNames(db: SqliteDb, table: string): Set<string> {
	return new Set(
		db
			.prepare(`PRAGMA table_info(${table});`)
			.all()
			.map((c) => c.name as string),
	);
}

export function ensureSessionSchema(
	db: SqliteDb,
	options: SessionSchemaOptions = {},
): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	for (const stmt of SCHEMA_STATEMENTS) {
		db.exec(stmt);
	}

	if (!options.includeLegacyMigrations) return;

	const columnCache = new Map<string, Set<string>>();
	const getColumns = (table: string) => {
		let cols = columnCache.get(table);
		if (!cols) {
			cols = getColumnNames(db, table);
			columnCache.set(table, cols);
		}
		return cols;
	};

	for (const migration of LEGACY_MIGRATIONS) {
		if (!getColumns(migration.table).has(migration.column)) {
			db.exec(migration.sql);
			if (migration.column === "workspace_root") {
				db.exec(
					"UPDATE sessions SET workspace_root = cwd WHERE workspace_root IS NULL OR workspace_root = '';",
				);
			}
		}
	}
}
