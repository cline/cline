/**
 * SQLite authority database (Gateway RFC, Phase 3; ADR 0001).
 *
 * The Gateway is the only writer of new-path state. Everything durable —
 * the bot registry, sessions, runs and their attempts, the global event
 * log, canonical message history, the idempotency ledger, the outbox,
 * the audit trail, and the client registry — lives in one SQLite file
 * with versioned, forward-only migrations. Disk projections are derived
 * from this database through the outbox; the database is authoritative.
 */

import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";

export interface GatewayMigration {
	readonly version: number;
	readonly name: string;
	readonly statements: readonly string[];
}

export const GATEWAY_MIGRATIONS: readonly GatewayMigration[] = [
	{
		version: 1,
		name: "phase-3-authority",
		statements: [
			`CREATE TABLE meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);`,
			`CREATE TABLE bots (
				bot_id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				role TEXT NOT NULL,
				parent_bot_id TEXT,
				created_by TEXT NOT NULL,
				reason TEXT,
				created_at INTEGER NOT NULL,
				config_json TEXT NOT NULL,
				status TEXT NOT NULL,
				revision INTEGER NOT NULL
			);`,
			`CREATE TABLE sessions (
				session_id TEXT PRIMARY KEY,
				bot_id TEXT NOT NULL,
				workspace_root TEXT NOT NULL,
				state TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				revision INTEGER NOT NULL
			);`,
			`CREATE INDEX idx_sessions_bot ON sessions(bot_id, created_at);`,
			`CREATE TABLE runs (
				run_id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL,
				bot_id TEXT NOT NULL,
				state TEXT NOT NULL,
				input TEXT NOT NULL,
				accepted_at INTEGER NOT NULL,
				accepted_seq INTEGER NOT NULL,
				instance_id TEXT NOT NULL,
				started_at INTEGER,
				ended_at INTEGER,
				output_text TEXT,
				error_name TEXT,
				error_message TEXT
			);`,
			`CREATE INDEX idx_runs_session ON runs(session_id, accepted_seq);`,
			`CREATE INDEX idx_runs_state ON runs(state);`,
			`CREATE TABLE run_attempts (
				attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
				run_id TEXT NOT NULL,
				attempt INTEGER NOT NULL,
				state TEXT NOT NULL,
				instance_id TEXT NOT NULL,
				started_at INTEGER NOT NULL,
				ended_at INTEGER,
				error_name TEXT,
				error_message TEXT,
				UNIQUE (run_id, attempt)
			);`,
			`CREATE TABLE events (
				sequence INTEGER PRIMARY KEY AUTOINCREMENT,
				event TEXT NOT NULL,
				bot_id TEXT,
				session_id TEXT,
				run_id TEXT,
				payload_json TEXT,
				created_at INTEGER NOT NULL
			);`,
			`CREATE INDEX idx_events_session ON events(session_id, sequence);`,
			`CREATE INDEX idx_events_run ON events(run_id, sequence);`,
			`CREATE TABLE messages (
				message_seq INTEGER PRIMARY KEY AUTOINCREMENT,
				session_id TEXT NOT NULL,
				run_id TEXT,
				message_id TEXT NOT NULL,
				role TEXT NOT NULL,
				message_json TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);`,
			`CREATE INDEX idx_messages_session ON messages(session_id, message_seq);`,
			`CREATE TABLE idempotency (
				key TEXT PRIMARY KEY,
				method TEXT NOT NULL,
				params_fingerprint TEXT NOT NULL,
				response_json TEXT,
				created_at INTEGER NOT NULL
			);`,
			`CREATE TABLE outbox (
				outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
				kind TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				state TEXT NOT NULL DEFAULT 'pending',
				attempts INTEGER NOT NULL DEFAULT 0,
				last_error TEXT,
				created_at INTEGER NOT NULL,
				done_at INTEGER
			);`,
			`CREATE INDEX idx_outbox_pending ON outbox(state, outbox_id);`,
			`CREATE TABLE audit (
				audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
				at INTEGER NOT NULL,
				actor TEXT NOT NULL,
				action TEXT NOT NULL,
				subject TEXT,
				details_json TEXT
			);`,
			`CREATE TABLE clients (
				client_id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				version TEXT NOT NULL,
				first_seen_at INTEGER NOT NULL,
				last_seen_at INTEGER NOT NULL,
				connections INTEGER NOT NULL DEFAULT 0
			);`,
		],
	},
];

export class GatewayDatabase {
	readonly db: SqliteDb;
	private transactionDepth = 0;

	constructor(db: SqliteDb) {
		this.db = db;
	}

	/**
	 * Run `fn` inside one immediate transaction. Nested calls join the
	 * outer transaction (SQLite has a single writer anyway).
	 */
	transaction<T>(fn: () => T): T {
		if (this.transactionDepth > 0) {
			this.transactionDepth += 1;
			try {
				return fn();
			} finally {
				this.transactionDepth -= 1;
			}
		}
		this.db.exec("BEGIN IMMEDIATE;");
		this.transactionDepth = 1;
		try {
			const result = fn();
			this.db.exec("COMMIT;");
			return result;
		} catch (error) {
			try {
				this.db.exec("ROLLBACK;");
			} catch {
				// Rollback failures must not mask the original error.
			}
			throw error;
		} finally {
			this.transactionDepth = 0;
		}
	}

	close(): void {
		this.db.close?.();
	}
}

function appliedMigrationVersions(db: SqliteDb): Set<number> {
	db.exec(
		`CREATE TABLE IF NOT EXISTS migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		);`,
	);
	return new Set(
		db
			.prepare("SELECT version FROM migrations ORDER BY version;")
			.all()
			.map((row) => Number(row.version)),
	);
}

export function migrateGatewayDatabase(db: SqliteDb): void {
	const applied = appliedMigrationVersions(db);
	for (const migration of GATEWAY_MIGRATIONS) {
		if (applied.has(migration.version)) {
			continue;
		}
		db.exec("BEGIN IMMEDIATE;");
		try {
			for (const statement of migration.statements) {
				db.exec(statement);
			}
			db.prepare(
				"INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?);",
			).run(migration.version, migration.name, Date.now());
			db.exec("COMMIT;");
		} catch (error) {
			try {
				db.exec("ROLLBACK;");
			} catch {
				// Keep the original migration error.
			}
			throw error;
		}
	}
}

export function openGatewayDatabase(databaseFile: string): GatewayDatabase {
	const db = loadSqliteDb(databaseFile);
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec("PRAGMA foreign_keys = ON;");
	db.exec("PRAGMA synchronous = NORMAL;");
	migrateGatewayDatabase(db);
	return new GatewayDatabase(db);
}
