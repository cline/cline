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
}
