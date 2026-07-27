import type { SqliteDb } from "@cline/shared/db";

/**
 * Bootstrap the dedicated status.db schema (ARD-0005).
 *
 * Owned by @cline/core for the same reason cron's schema is: status lifecycle
 * and retention are core concerns and should not couple to session storage.
 */

const STATUS_SCHEMA_STATEMENTS: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS status_updates (
		update_id TEXT PRIMARY KEY,
		seq INTEGER NOT NULL,
		subject TEXT NOT NULL,
		state TEXT NOT NULL CHECK (state IN
			('queued', 'running', 'blocked', 'done', 'failed', 'cancelled')),
		headline TEXT NOT NULL,
		detail TEXT,
		priority TEXT NOT NULL DEFAULT 'normal'
			CHECK (priority IN ('low', 'normal', 'high', 'critical')),
		progress REAL,
		session_id TEXT,
		agent_id TEXT,
		agent_name TEXT,
		workspace_root TEXT,
		source TEXT NOT NULL,
		tags_json TEXT,
		metadata_json TEXT,
		superseded_at TEXT,
		created_at TEXT NOT NULL
	);`,
	/**
	 * Exactly one live row per subject. Makes "two current rows" unrepresentable
	 * rather than something the service has to police, and turns "current status
	 * of X" into a single index probe.
	 */
	`CREATE UNIQUE INDEX IF NOT EXISTS status_current_idx
		ON status_updates(subject) WHERE superseded_at IS NULL;`,
	`CREATE UNIQUE INDEX IF NOT EXISTS status_seq_idx
		ON status_updates(seq DESC);`,
	`CREATE INDEX IF NOT EXISTS status_subject_idx
		ON status_updates(subject, seq DESC);`,
	/** "What is blocked right now" — the supervisor's hottest query. */
	`CREATE INDEX IF NOT EXISTS status_live_state_idx
		ON status_updates(state, seq DESC) WHERE superseded_at IS NULL;`,
	`CREATE INDEX IF NOT EXISTS status_agent_idx
		ON status_updates(agent_id, seq DESC);`,
	`CREATE INDEX IF NOT EXISTS status_session_idx
		ON status_updates(session_id, seq DESC);`,
	`CREATE INDEX IF NOT EXISTS status_priority_idx
		ON status_updates(priority, seq DESC);`,
];

/**
 * FTS5 is a compile-time SQLite option and is NOT universally present:
 * measured available under `bun:sqlite` (Bun 1.3.13) and missing under
 * `node:sqlite` (Node 22.14, `no such module: fts5`). Since the published SDK
 * runs on Node, LIKE is the baseline and FTS5 is an opportunistic upgrade.
 */
const FTS_STATEMENTS: readonly string[] = [
	`CREATE VIRTUAL TABLE IF NOT EXISTS status_fts USING fts5(
		headline,
		detail,
		content='status_updates',
		content_rowid='rowid'
	);`,
	`CREATE TRIGGER IF NOT EXISTS status_fts_ai AFTER INSERT ON status_updates BEGIN
		INSERT INTO status_fts(rowid, headline, detail)
		VALUES (new.rowid, new.headline, new.detail);
	END;`,
	`CREATE TRIGGER IF NOT EXISTS status_fts_ad AFTER DELETE ON status_updates BEGIN
		INSERT INTO status_fts(status_fts, rowid, headline, detail)
		VALUES ('delete', old.rowid, old.headline, old.detail);
	END;`,
	`CREATE TRIGGER IF NOT EXISTS status_fts_au AFTER UPDATE ON status_updates BEGIN
		INSERT INTO status_fts(status_fts, rowid, headline, detail)
		VALUES ('delete', old.rowid, old.headline, old.detail);
		INSERT INTO status_fts(rowid, headline, detail)
		VALUES (new.rowid, new.headline, new.detail);
	END;`,
];

export type StatusSchemaInfo = {
	/** True when FTS5 exists and `status_fts` is usable for text search. */
	ftsAvailable: boolean;
};

function probeFts5(db: SqliteDb): boolean {
	try {
		db.exec(
			"CREATE VIRTUAL TABLE IF NOT EXISTS status_fts_probe USING fts5(probe);",
		);
		db.exec("DROP TABLE IF EXISTS status_fts_probe;");
		return true;
	} catch {
		return false;
	}
}

export function ensureStatusSchema(db: SqliteDb): StatusSchemaInfo {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	for (const stmt of STATUS_SCHEMA_STATEMENTS) {
		db.exec(stmt);
	}

	if (!probeFts5(db)) {
		return { ftsAvailable: false };
	}

	try {
		for (const stmt of FTS_STATEMENTS) {
			db.exec(stmt);
		}
		return { ftsAvailable: true };
	} catch {
		// FTS5 exists but the index could not be built (e.g. a partially
		// migrated DB). Text search falls back to LIKE rather than failing.
		return { ftsAvailable: false };
	}
}
