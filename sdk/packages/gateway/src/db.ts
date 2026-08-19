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
			// --- Usage/statistics pipeline (write path; Phase 7 reads it) ---
			// One normalized record per model call. Original cost fields are
			// immutable; recalculations land in recalculated_* columns.
			`CREATE TABLE usage_events (
				event_id INTEGER PRIMARY KEY AUTOINCREMENT,
				occurred_at INTEGER NOT NULL,
				date TEXT NOT NULL,
				bot_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				run_id TEXT NOT NULL,
				provider_id TEXT,
				model_id TEXT,
				agent_id TEXT NOT NULL,
				topic_id TEXT NOT NULL,
				input_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				total_tokens INTEGER NOT NULL,
				estimated_cost REAL,
				cost_is_estimate INTEGER NOT NULL DEFAULT 1,
				price_snapshot_json TEXT,
				recalculated_cost REAL,
				recalculated_price_json TEXT,
				duration_ms INTEGER,
				status TEXT NOT NULL
			);`,
			`CREATE INDEX idx_usage_events_bot ON usage_events(bot_id, occurred_at);`,
			`CREATE INDEX idx_usage_events_model ON usage_events(model_id, occurred_at);`,
			`CREATE INDEX idx_usage_events_topic ON usage_events(topic_id, occurred_at);`,
			`CREATE INDEX idx_usage_events_time ON usage_events(occurred_at);`,
			`CREATE TABLE daily_usage (
				date TEXT NOT NULL,
				bot_id TEXT NOT NULL,
				tokens INTEGER NOT NULL DEFAULT 0,
				input_tokens INTEGER NOT NULL DEFAULT 0,
				output_tokens INTEGER NOT NULL DEFAULT 0,
				messages INTEGER NOT NULL DEFAULT 0,
				model_calls INTEGER NOT NULL DEFAULT 0,
				estimated_cost REAL NOT NULL DEFAULT 0,
				active_sessions INTEGER NOT NULL DEFAULT 0,
				active_agents INTEGER NOT NULL DEFAULT 1,
				max_run_duration_ms INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (date, bot_id)
			);`,
			`CREATE TABLE model_usage (
				date TEXT NOT NULL,
				model_id TEXT NOT NULL,
				provider_id TEXT NOT NULL,
				messages INTEGER NOT NULL DEFAULT 0,
				tokens INTEGER NOT NULL DEFAULT 0,
				estimated_cost REAL NOT NULL DEFAULT 0,
				PRIMARY KEY (date, model_id, provider_id)
			);`,
			`CREATE TABLE agent_usage (
				date TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				messages INTEGER NOT NULL DEFAULT 0,
				tokens INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (date, agent_id)
			);`,
			`CREATE TABLE topic_usage (
				date TEXT NOT NULL,
				topic_id TEXT NOT NULL,
				messages INTEGER NOT NULL DEFAULT 0,
				tokens INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (date, topic_id)
			);`,
			`CREATE TABLE streak_usage (
				date TEXT PRIMARY KEY,
				active INTEGER NOT NULL DEFAULT 1
			);`,
			// Uniqueness helper so daily_usage.active_sessions stays an O(1)
			// incremental counter instead of a rescan.
			`CREATE TABLE usage_seen_sessions (
				date TEXT NOT NULL,
				session_id TEXT NOT NULL,
				bot_id TEXT NOT NULL,
				PRIMARY KEY (date, session_id)
			);`,
		],
	},
	{
		version: 2,
		name: "phase-4-6-plugins-connectors-schedules",
		statements: [
			// Phase 4: durable plugin state lives behind a Gateway storage
			// port, never inside the plugin package or the worker.
			`CREATE TABLE plugin_state (
				plugin_name TEXT NOT NULL,
				scope TEXT NOT NULL,
				key TEXT NOT NULL,
				value_json TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				PRIMARY KEY (plugin_name, scope, key)
			);`,
			// Phase 6: connectors are bot-scoped — config and conversation
			// routes live in the bot namespace, one connector, one bot.
			`CREATE TABLE connectors (
				connector_id TEXT PRIMARY KEY,
				bot_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				name TEXT NOT NULL,
				config_json TEXT NOT NULL,
				credential_ref TEXT,
				status TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				revision INTEGER NOT NULL
			);`,
			`CREATE INDEX idx_connectors_bot ON connectors(bot_id, created_at);`,
			`CREATE TABLE connector_routes (
				connector_id TEXT NOT NULL,
				external_account_id TEXT NOT NULL,
				external_conversation_id TEXT NOT NULL,
				bot_id TEXT NOT NULL,
				session_id TEXT NOT NULL,
				principal_id TEXT,
				created_at INTEGER NOT NULL,
				PRIMARY KEY (connector_id, external_account_id, external_conversation_id)
			);`,
			`CREATE INDEX idx_connector_routes_session ON connector_routes(session_id);`,
			// Crash-safe dedupe cursor: committed in the same transaction as
			// the work an inbound update caused.
			`CREATE TABLE connector_cursors (
				connector_id TEXT PRIMARY KEY,
				cursor TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			);`,
			// One live worker per connector instance; a restart re-claims the
			// row instead of creating a duplicate instance.
			`CREATE TABLE connector_instances (
				connector_id TEXT PRIMARY KEY,
				worker_id TEXT NOT NULL,
				gateway_instance_id TEXT NOT NULL,
				started_at INTEGER NOT NULL,
				heartbeat_at INTEGER NOT NULL
			);`,
			// Phase 6: schedules — Gateway owns triggers, durable claims,
			// retries, and reports.
			`CREATE TABLE schedules (
				schedule_id TEXT PRIMARY KEY,
				bot_id TEXT NOT NULL,
				name TEXT NOT NULL,
				prompt TEXT NOT NULL,
				interval_ms INTEGER,
				at INTEGER,
				next_due_at INTEGER,
				enabled INTEGER NOT NULL DEFAULT 1,
				max_attempts INTEGER NOT NULL DEFAULT 1,
				created_at INTEGER NOT NULL,
				revision INTEGER NOT NULL
			);`,
			`CREATE INDEX idx_schedules_due ON schedules(enabled, next_due_at);`,
			`CREATE TABLE schedule_jobs (
				job_id INTEGER PRIMARY KEY AUTOINCREMENT,
				schedule_id TEXT NOT NULL,
				due_at INTEGER NOT NULL,
				state TEXT NOT NULL,
				claimed_by TEXT,
				claim_expires_at INTEGER,
				attempts INTEGER NOT NULL DEFAULT 0,
				run_id TEXT,
				last_error TEXT,
				created_at INTEGER NOT NULL,
				settled_at INTEGER,
				UNIQUE (schedule_id, due_at)
			);`,
			`CREATE INDEX idx_schedule_jobs_state ON schedule_jobs(state, due_at);`,
			// Phase 6: explicit run provenance (interactive/connector/automation).
			`CREATE TABLE run_provenance (
				run_id TEXT PRIMARY KEY,
				mode TEXT NOT NULL,
				provenance_json TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);`,
		],
	},
	{
		version: 2,
		name: "snapshot-run-config",
		statements: ["ALTER TABLE runs ADD COLUMN config_json TEXT;"],
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
