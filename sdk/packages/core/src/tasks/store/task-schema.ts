import type { SqliteDb } from "@cline/shared/db";

const TASK_SCHEMA_STATEMENTS: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS agenda_tasks (
		task_id TEXT PRIMARY KEY,
		type TEXT NOT NULL CHECK (type IN ('suggestion', 'follow-up', 'todo', 'handoff', 'idea', 'reminder')),
		status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'in_progress', 'completed', 'failed', 'cancelled', 'expired')),
		title TEXT NOT NULL,
		description TEXT,
		instructions TEXT NOT NULL,
		scope TEXT NOT NULL CHECK (scope IN ('workspace', 'global')),
		workspace_root TEXT,
		cwd TEXT,
		resource_paths_json TEXT NOT NULL DEFAULT '[]',
		priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 0 AND 5),
		assignee TEXT,
		model_selection_json TEXT,
		mode TEXT CHECK (mode IS NULL OR mode IN ('act', 'plan', 'yolo')),
		system_prompt TEXT,
		max_iterations INTEGER,
		timeout_seconds INTEGER,
		available_at TEXT NOT NULL,
		expires_at TEXT NOT NULL,
		automation_eligible INTEGER NOT NULL DEFAULT 1,
		revision INTEGER NOT NULL DEFAULT 1,
		approved_revision INTEGER,
		created_by_json TEXT NOT NULL,
		updated_by_json TEXT NOT NULL,
		origin_session_id TEXT,
		origin_task_id TEXT,
		current_run_id TEXT,
		last_run_id TEXT,
		last_session_id TEXT,
		spec_path TEXT UNIQUE,
		error TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		completed_at TEXT,
		archived_at TEXT,
		CHECK (
			(scope = 'workspace' AND workspace_root IS NOT NULL) OR
			(scope = 'global' AND workspace_root IS NULL)
		)
	);`,
	`CREATE TABLE IF NOT EXISTS agenda_task_runs (
		run_id TEXT PRIMARY KEY,
		task_id TEXT NOT NULL REFERENCES agenda_tasks(task_id) ON DELETE CASCADE,
		task_revision INTEGER NOT NULL,
		attempt INTEGER NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
		claim_token TEXT,
		claim_until_at TEXT,
		requested_by_client_id TEXT,
		session_id TEXT,
		claimed_at TEXT NOT NULL,
		started_at TEXT,
		completed_at TEXT,
		result_summary TEXT,
		error TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		UNIQUE (task_id, attempt)
	);`,
	`CREATE TABLE IF NOT EXISTS agenda_task_automation (
		scope_key TEXT PRIMARY KEY,
		mode TEXT NOT NULL CHECK (mode IN ('manual', 'auto_start', 'unattended')),
		apply_to_agent_created INTEGER NOT NULL DEFAULT 1,
		max_concurrent_runs INTEGER NOT NULL DEFAULT 2,
		max_chain_depth INTEGER NOT NULL DEFAULT 1,
		max_starts_per_hour INTEGER NOT NULL DEFAULT 20,
		enabled_by_json TEXT,
		enabled_at TEXT,
		updated_at TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS factory_queue (
		task_id TEXT PRIMARY KEY REFERENCES agenda_tasks(task_id) ON DELETE CASCADE,
		task_revision INTEGER NOT NULL,
		actor_json TEXT NOT NULL,
		requested_by_client_id TEXT,
		created_at TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS factory_counter (
		name TEXT PRIMARY KEY,
		last_number INTEGER NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS agenda_tasks_ready_idx
		ON agenda_tasks(status, priority, available_at, expires_at, created_at);`,
	`CREATE INDEX IF NOT EXISTS agenda_tasks_scope_idx
		ON agenda_tasks(scope, workspace_root, status, available_at);`,
	`CREATE INDEX IF NOT EXISTS agenda_tasks_origin_session_idx
		ON agenda_tasks(origin_session_id, created_at);`,
	`CREATE INDEX IF NOT EXISTS agenda_task_runs_task_idx
		ON agenda_task_runs(task_id, attempt DESC);`,
	`CREATE INDEX IF NOT EXISTS agenda_task_runs_session_idx
		ON agenda_task_runs(session_id);`,
	`CREATE UNIQUE INDEX IF NOT EXISTS agenda_task_runs_one_active_idx
		ON agenda_task_runs(task_id)
		WHERE status IN ('starting', 'running');`,
];

export function ensureAgendaTaskSchema(db: SqliteDb): void {
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	db.exec("PRAGMA foreign_keys = ON;");
	for (const statement of TASK_SCHEMA_STATEMENTS) {
		db.exec(statement);
	}
	if (
		!db
			.prepare("PRAGMA table_info(agenda_tasks)")
			.all()
			.some((column) => column.name === "factory_questions_json")
	) {
		db.exec("ALTER TABLE agenda_tasks ADD COLUMN factory_questions_json TEXT");
	}
	for (const [table, column, declaration] of [
		["agenda_tasks", "factory_design_sessions_json", "TEXT"],
		["agenda_tasks", "factory_design_progress_json", "TEXT"],
		["factory_queue", "stage", "TEXT NOT NULL DEFAULT 'run'"],
		["agenda_tasks", "factory_number", "INTEGER"],
		// The Factory priority, written only by setFactoryPriority and creation.
		["agenda_tasks", "factory_priority_json", "TEXT"],
		// Repeats matched to the card, written only by recordFactoryDuplicateReport.
		["agenda_tasks", "factory_duplicate_reports_json", "TEXT"],
	]) {
		const present = () =>
			db
				.prepare(`PRAGMA table_info(${table})`)
				.all()
				.some((entry) => entry.name === column);
		if (present()) continue;
		try {
			db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
		} catch (error) {
			// Another Hub opening the same database may have added it first.
			if (!present()) throw error;
		}
	}
	for (const table of ["agenda_tasks", "agenda_task_runs"]) {
		const columns = db.prepare(`PRAGMA table_info(${table})`).all();
		if (!columns.some((column) => column.name === "factory_json")) {
			db.exec(`ALTER TABLE ${table} ADD COLUMN factory_json TEXT`);
		}
	}
	// Expressions match the store's lookups so SQLite can use these indexes.
	for (const [name, columns] of [
		[
			"agenda_tasks_factory_intake_idx",
			"scope, workspace_root, json_extract(factory_json, '$.intake.source'), json_extract(factory_json, '$.intake.key')",
		],
		[
			"agenda_tasks_factory_replay_run_idx",
			"json_extract(factory_json, '$.replay.sourceRunId')",
		],
		[
			"agenda_tasks_factory_comparison_idx",
			"json_extract(factory_json, '$.replay.comparisonId')",
		],
	])
		db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON agenda_tasks(${columns})`);
	if (
		!db
			.prepare("PRAGMA table_info(agenda_tasks)")
			.all()
			.some((column) => column.name === "factory_design_review_json")
	) {
		db.exec(
			"ALTER TABLE agenda_tasks ADD COLUMN factory_design_review_json TEXT",
		);
	}
	db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS agenda_tasks_factory_number_idx
		ON agenda_tasks(factory_number) WHERE factory_number IS NOT NULL`);
	db.exec(`CREATE INDEX IF NOT EXISTS agenda_tasks_factory_unnumbered_idx
		ON agenda_tasks(created_at)
		WHERE factory_number IS NULL AND factory_json IS NOT NULL`);
	// Number Factory cards created before short ids existed, or by an older
	// Hub sharing this database since. Idempotent: only unnumbered cards move.
	if (
		!db
			.prepare(
				"SELECT 1 FROM agenda_tasks WHERE factory_number IS NULL AND factory_json IS NOT NULL LIMIT 1",
			)
			.get()
	)
		return;
	db.exec("BEGIN IMMEDIATE;");
	try {
		numberFactoryCards(db);
		db.exec("COMMIT;");
	} catch (error) {
		db.exec("ROLLBACK;");
		throw error;
	}
}

/**
 * Give every Factory card without a short number the next numbers, in
 * creation order. The counter only grows, so a number is never reused after
 * its card is deleted. Call inside a write transaction.
 */
export function numberFactoryCards(db: SqliteDb): void {
	const unnumbered = db
		.prepare(
			`SELECT task_id FROM agenda_tasks
			WHERE factory_number IS NULL AND factory_json IS NOT NULL
			ORDER BY created_at ASC, rowid ASC`,
		)
		.all();
	if (unnumbered.length === 0) return;
	const row = db
		.prepare(
			`SELECT MAX(
				COALESCE((SELECT last_number FROM factory_counter WHERE name = 'card'), 0),
				COALESCE((SELECT MAX(factory_number) FROM agenda_tasks), 0)
			) AS last_number`,
		)
		.get();
	let last = Number(row?.last_number ?? 0);
	const assign = db.prepare(
		"UPDATE agenda_tasks SET factory_number = ? WHERE task_id = ?",
	);
	for (const card of unnumbered) assign.run(++last, card.task_id);
	db.prepare(
		`INSERT INTO factory_counter (name, last_number) VALUES ('card', ?)
		ON CONFLICT(name) DO UPDATE SET last_number = excluded.last_number`,
	).run(last);
}
