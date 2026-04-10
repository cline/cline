import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	safeJsonParse,
	type TeamRuntimeState,
	type TeamTeammateSpec,
} from "@clinebot/shared";
import { loadSqliteDb, nowIso, type SqliteDb } from "@clinebot/shared/db";
import { resolveTeamDataDir } from "@clinebot/shared/storage";
import type { TeamEvent } from "../team";
import type { TeamStore } from "../types/storage";

function defaultTeamDir(): string {
	return resolveTeamDataDir();
}

function sanitizeTeamName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export interface SqliteTeamStoreOptions {
	teamDir?: string;
}

export interface TeamRuntimeLoadResult {
	state?: TeamRuntimeState;
	teammates: TeamTeammateSpec[];
	interruptedRunIds: string[];
}

interface TeamSnapshotRow {
	team_name: string;
	state_json: string;
	teammates_json: string;
	updated_at: string;
}

interface TeamRunRow {
	run_id: string;
}

function parseTeammatesJson(raw: string): TeamTeammateSpec[] {
	const parsed = safeJsonParse<unknown>(raw);
	if (!Array.isArray(parsed)) {
		return [];
	}
	const out: TeamTeammateSpec[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const rec = entry as Record<string, unknown>;
		const agentId = rec.agentId;
		const rolePrompt = rec.rolePrompt;
		if (typeof agentId !== "string" || !agentId.trim()) {
			continue;
		}
		if (typeof rolePrompt !== "string" || !rolePrompt.trim()) {
			continue;
		}
		const spec: TeamTeammateSpec = {
			agentId: agentId.trim(),
			rolePrompt,
		};
		if (typeof rec.modelId === "string" && rec.modelId.trim()) {
			spec.modelId = rec.modelId.trim();
		}
		if (
			typeof rec.maxIterations === "number" &&
			Number.isFinite(rec.maxIterations)
		) {
			spec.maxIterations = Math.max(1, Math.floor(rec.maxIterations));
		}
		out.push(spec);
	}
	return out;
}

function reviveTeamRuntimeStateDates(
	state: TeamRuntimeState,
): TeamRuntimeState {
	return {
		...state,
		tasks: state.tasks.map((task) => ({
			...task,
			createdAt: new Date(task.createdAt),
			updatedAt: new Date(task.updatedAt),
		})),
		mailbox: state.mailbox.map((message) => ({
			...message,
			sentAt: new Date(message.sentAt),
			readAt: message.readAt ? new Date(message.readAt) : undefined,
		})),
		missionLog: state.missionLog.map((entry) => ({
			...entry,
			ts: new Date(entry.ts),
		})),
		runs: (state.runs ?? []).map((run) => ({
			...run,
			startedAt: new Date(run.startedAt),
			endedAt: run.endedAt ? new Date(run.endedAt) : undefined,
			nextAttemptAt: run.nextAttemptAt
				? new Date(run.nextAttemptAt)
				: undefined,
			heartbeatAt: run.heartbeatAt ? new Date(run.heartbeatAt) : undefined,
		})),
		outcomes: (state.outcomes ?? []).map((outcome) => ({
			...outcome,
			createdAt: new Date(outcome.createdAt),
			finalizedAt: outcome.finalizedAt
				? new Date(outcome.finalizedAt)
				: undefined,
		})),
		outcomeFragments: (state.outcomeFragments ?? []).map((fragment) => ({
			...fragment,
			createdAt: new Date(fragment.createdAt),
			reviewedAt: fragment.reviewedAt
				? new Date(fragment.reviewedAt)
				: undefined,
		})),
	};
}

export class SqliteTeamStore implements TeamStore {
	private readonly teamDirPath: string;
	private db: SqliteDb | undefined;

	constructor(options: SqliteTeamStoreOptions = {}) {
		this.teamDirPath = options.teamDir ?? defaultTeamDir();
	}

	init(): void {
		this.getRawDb();
	}

	private ensureTeamDir(): string {
		if (!existsSync(this.teamDirPath)) {
			mkdirSync(this.teamDirPath, { recursive: true });
		}
		return this.teamDirPath;
	}

	private dbPath(): string {
		return join(this.ensureTeamDir(), "teams.db");
	}

	private getRawDb(): SqliteDb {
		if (this.db) {
			return this.db;
		}
		const db = loadSqliteDb(this.dbPath());
		this.ensureSchema(db);
		this.db = db;
		return db;
	}

	private ensureSchema(db: SqliteDb): void {
		db.exec("PRAGMA journal_mode = WAL;");
		db.exec("PRAGMA busy_timeout = 5000;");
		// Single-row table so ALTER-based upgrades can run in order (baseline = 1).
		// Session/schedule schemas use separate migration paths in @clinebot/shared.
		db.exec(`
			CREATE TABLE IF NOT EXISTS team_store_schema_version (
				lock INTEGER PRIMARY KEY CHECK (lock = 1),
				version INTEGER NOT NULL
			);
		`);
		const versionRow = db
			.prepare("SELECT version FROM team_store_schema_version WHERE lock = 1")
			.get() as { version: number } | null;
		if (!versionRow) {
			db.prepare(
				"INSERT INTO team_store_schema_version (lock, version) VALUES (1, 1)",
			).run();
		}
		db.exec(`
			CREATE TABLE IF NOT EXISTS team_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				team_name TEXT NOT NULL,
				ts TEXT NOT NULL,
				event_type TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				causation_id TEXT,
				correlation_id TEXT
			);
		`);
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_team_events_name_ts
				ON team_events(team_name, ts DESC);
		`);
		db.exec(`
			CREATE TABLE IF NOT EXISTS team_runtime_snapshot (
				team_name TEXT PRIMARY KEY,
				state_json TEXT NOT NULL,
				teammates_json TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
		db.exec(`
			CREATE TABLE IF NOT EXISTS team_tasks (
				team_name TEXT NOT NULL,
				task_id TEXT NOT NULL,
				title TEXT NOT NULL,
				description TEXT NOT NULL,
				status TEXT NOT NULL,
				assignee TEXT,
				depends_on_json TEXT NOT NULL,
				summary TEXT,
				version INTEGER NOT NULL DEFAULT 1,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(team_name, task_id)
			);
		`);
		db.exec(`
			CREATE TABLE IF NOT EXISTS team_runs (
				team_name TEXT NOT NULL,
				run_id TEXT NOT NULL,
				agent_id TEXT NOT NULL,
				task_id TEXT,
				status TEXT NOT NULL,
				message TEXT NOT NULL,
				started_at TEXT,
				ended_at TEXT,
				error TEXT,
				lease_owner TEXT,
				heartbeat_at TEXT,
				version INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY(team_name, run_id)
			);
		`);
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_team_runs_status
				ON team_runs(team_name, status);
		`);
		db.exec(`
			CREATE TABLE IF NOT EXISTS team_outcomes (
				team_name TEXT NOT NULL,
				outcome_id TEXT NOT NULL,
				title TEXT NOT NULL,
				status TEXT NOT NULL,
				schema_json TEXT NOT NULL,
				finalized_at TEXT,
				version INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY(team_name, outcome_id)
			);
		`);
		db.exec(`
			CREATE TABLE IF NOT EXISTS team_outcome_fragments (
				team_name TEXT NOT NULL,
				outcome_id TEXT NOT NULL,
				fragment_id TEXT NOT NULL,
				section TEXT NOT NULL,
				source_agent_id TEXT NOT NULL,
				source_run_id TEXT,
				content TEXT NOT NULL,
				status TEXT NOT NULL,
				reviewed_by TEXT,
				reviewed_at TEXT,
				version INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY(team_name, fragment_id)
			);
		`);
	}

	private run(sql: string, params: unknown[] = []): { changes?: number } {
		return this.getRawDb()
			.prepare(sql)
			.run(...params);
	}

	private queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
		const row = this.getRawDb()
			.prepare(sql)
			.get(...params);
		return (row as T | null) ?? undefined;
	}

	private queryAll<T>(sql: string, params: unknown[] = []): T[] {
		return this.getRawDb()
			.prepare(sql)
			.all(...params) as T[];
	}

	/** Runs `work` in a single SQLite transaction (rollback on any error). */
	private withTransaction(work: () => void): void {
		const db = this.getRawDb();
		db.exec("BEGIN IMMEDIATE;");
		try {
			work();
			db.exec("COMMIT;");
		} catch (error) {
			try {
				db.exec("ROLLBACK;");
			} catch {
				// ignore secondary failure
			}
			throw error;
		}
	}

	listTeamNames(): string[] {
		return this.queryAll<{ team_name: string }>(
			`SELECT team_name FROM team_runtime_snapshot ORDER BY team_name ASC`,
		).map((row) => row.team_name);
	}

	readState(teamName: string): TeamRuntimeState | undefined {
		const row = this.queryOne<TeamSnapshotRow>(
			`SELECT team_name, state_json, teammates_json, updated_at FROM team_runtime_snapshot WHERE team_name = ?`,
			[sanitizeTeamName(teamName)],
		);
		if (!row) {
			return undefined;
		}
		const parsed = safeJsonParse<TeamRuntimeState>(row.state_json);
		if (!parsed) {
			return undefined;
		}
		try {
			return reviveTeamRuntimeStateDates(parsed);
		} catch {
			return undefined;
		}
	}

	readHistory(teamName: string, limit = 200): unknown[] {
		return this.queryAll<{
			event_type: string;
			payload_json: string;
			ts: string;
		}>(
			`SELECT event_type, payload_json, ts FROM team_events WHERE team_name = ? ORDER BY id DESC LIMIT ?`,
			[sanitizeTeamName(teamName), limit],
		).flatMap((row) => {
			try {
				return [
					{
						eventType: row.event_type,
						payload: JSON.parse(row.payload_json),
						ts: row.ts,
					},
				];
			} catch {
				return [];
			}
		});
	}

	loadRuntime(teamName: string): TeamRuntimeLoadResult {
		const safeTeamName = sanitizeTeamName(teamName);
		const state = this.readState(safeTeamName);
		const snapshotRow = this.queryOne<TeamSnapshotRow>(
			`SELECT team_name, state_json, teammates_json, updated_at FROM team_runtime_snapshot WHERE team_name = ?`,
			[safeTeamName],
		);
		const teammates = snapshotRow
			? parseTeammatesJson(snapshotRow.teammates_json)
			: [];
		const interruptedRunIds = this.markInProgressRunsInterrupted(
			safeTeamName,
			"runtime_recovered",
		);
		return {
			state,
			teammates,
			interruptedRunIds,
		};
	}

	appendTeamEvent(
		teamName: string,
		eventType: string,
		payload: unknown,
		correlationId?: string,
	): void {
		this.run(
			`INSERT INTO team_events (team_name, ts, event_type, payload_json, causation_id, correlation_id)
			 VALUES (?, ?, ?, ?, NULL, ?)`,
			[
				sanitizeTeamName(teamName),
				nowIso(),
				eventType,
				JSON.stringify(payload),
				correlationId ?? null,
			],
		);
	}

	persistRuntime(
		teamName: string,
		state: TeamRuntimeState,
		teammates: TeamTeammateSpec[],
	): void {
		const safeTeamName = sanitizeTeamName(teamName);
		const now = nowIso();
		this.withTransaction(() => {
			this.run(
				`INSERT INTO team_runtime_snapshot (team_name, state_json, teammates_json, updated_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(team_name) DO UPDATE SET
					state_json = excluded.state_json,
					teammates_json = excluded.teammates_json,
					updated_at = excluded.updated_at`,
				[safeTeamName, JSON.stringify(state), JSON.stringify(teammates), now],
			);

			for (const task of state.tasks) {
				this.run(
					`INSERT INTO team_tasks (team_name, task_id, title, description, status, assignee, depends_on_json, summary, version, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
					 ON CONFLICT(team_name, task_id) DO UPDATE SET
						title = excluded.title,
						description = excluded.description,
						status = excluded.status,
						assignee = excluded.assignee,
						depends_on_json = excluded.depends_on_json,
						summary = excluded.summary,
						version = team_tasks.version + 1,
						updated_at = excluded.updated_at`,
					[
						safeTeamName,
						task.id,
						task.title,
						task.description,
						task.status,
						task.assignee ?? null,
						JSON.stringify(task.dependsOn ?? []),
						task.summary ?? null,
						task.updatedAt.toISOString(),
					],
				);
			}

			for (const run of state.runs ?? []) {
				this.run(
					`INSERT INTO team_runs (team_name, run_id, agent_id, task_id, status, message, started_at, ended_at, error, lease_owner, heartbeat_at, version)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
					 ON CONFLICT(team_name, run_id) DO UPDATE SET
						agent_id = excluded.agent_id,
						task_id = excluded.task_id,
						status = excluded.status,
						message = excluded.message,
						started_at = excluded.started_at,
						ended_at = excluded.ended_at,
						error = excluded.error,
						lease_owner = excluded.lease_owner,
						heartbeat_at = excluded.heartbeat_at,
						version = team_runs.version + 1`,
					[
						safeTeamName,
						run.id,
						run.agentId,
						run.taskId ?? null,
						run.status,
						run.message,
						run.startedAt ? run.startedAt.toISOString() : null,
						run.endedAt ? run.endedAt.toISOString() : null,
						run.error ?? null,
						run.leaseOwner ?? null,
						run.heartbeatAt ? run.heartbeatAt.toISOString() : null,
					],
				);
			}

			for (const outcome of state.outcomes ?? []) {
				this.run(
					`INSERT INTO team_outcomes (team_name, outcome_id, title, status, schema_json, finalized_at, version)
					 VALUES (?, ?, ?, ?, ?, ?, 1)
					 ON CONFLICT(team_name, outcome_id) DO UPDATE SET
						title = excluded.title,
						status = excluded.status,
						schema_json = excluded.schema_json,
						finalized_at = excluded.finalized_at,
						version = team_outcomes.version + 1`,
					[
						safeTeamName,
						outcome.id,
						outcome.title,
						outcome.status,
						JSON.stringify({ requiredSections: outcome.requiredSections }),
						outcome.finalizedAt ? outcome.finalizedAt.toISOString() : null,
					],
				);
			}

			for (const fragment of state.outcomeFragments ?? []) {
				this.run(
					`INSERT INTO team_outcome_fragments (team_name, outcome_id, fragment_id, section, source_agent_id, source_run_id, content, status, reviewed_by, reviewed_at, version)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
					 ON CONFLICT(team_name, fragment_id) DO UPDATE SET
						outcome_id = excluded.outcome_id,
						section = excluded.section,
						source_agent_id = excluded.source_agent_id,
						source_run_id = excluded.source_run_id,
						content = excluded.content,
						status = excluded.status,
						reviewed_by = excluded.reviewed_by,
						reviewed_at = excluded.reviewed_at,
						version = team_outcome_fragments.version + 1`,
					[
						safeTeamName,
						fragment.outcomeId,
						fragment.id,
						fragment.section,
						fragment.sourceAgentId,
						fragment.sourceRunId ?? null,
						fragment.content,
						fragment.status,
						fragment.reviewedBy ?? null,
						fragment.reviewedAt ? fragment.reviewedAt.toISOString() : null,
					],
				);
			}
		});
	}

	markInProgressRunsInterrupted(teamName: string, reason: string): string[] {
		const safeTeamName = sanitizeTeamName(teamName);
		const rows = this.queryAll<TeamRunRow>(
			`SELECT run_id FROM team_runs WHERE team_name = ? AND status IN ('queued', 'running')`,
			[safeTeamName],
		);
		if (rows.length === 0) {
			return [];
		}
		const now = nowIso();
		this.run(
			`UPDATE team_runs SET status = 'interrupted', error = ?, ended_at = ?, version = version + 1
			 WHERE team_name = ? AND status IN ('queued', 'running')`,
			[reason, now, safeTeamName],
		);
		return rows.map((row) => row.run_id);
	}

	handleTeamEvent(teamName: string, event: TeamEvent): void {
		this.appendTeamEvent(teamName, event.type, event);
	}
}
