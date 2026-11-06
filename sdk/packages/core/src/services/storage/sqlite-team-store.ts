import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
	safeJsonParse,
	type TeamRuntimeState,
	type TeamTeammateSpec,
} from "@cline/shared";
import { loadSqliteDb, nowIso, type SqliteDb } from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";
import type {
	TeamEvent,
	TeamRuntimeStateDelta,
} from "../../extensions/tools/team";
// Import the policy module directly (not the team barrel) so storage does not
// pull the agent runtime into its module graph.
import {
	isDurableTeamEvent,
	toPersistableTeamEvent,
	toTeamRunResultRecord,
} from "../../extensions/tools/team/persistence-policy";
import { sanitizeTeamName } from "../../extensions/tools/team/sanitize-team-name";
import type { TeamPersistenceBatch, TeamStore } from "../../types/storage";

function defaultTeamDir(): string {
	return resolveDbDataDir();
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
			lastProgressAt: run.lastProgressAt
				? new Date(run.lastProgressAt)
				: undefined,
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

/** Durable event rows kept per team (history tool reads newest-first). */
export const TEAM_EVENT_RETENTION_PER_TEAM = 2000;
/** Event rows older than this are pruned regardless of count. */
export const TEAM_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Event types that are pure telemetry and must never be stored. */
const TELEMETRY_EVENT_TYPES = ["agent_event", "run_progress"] as const;
const TEAM_STORE_SCHEMA_VERSION = 2;
const ENTITY_TABLES = [
	"team_tasks",
	"team_runs",
	"team_outcomes",
	"team_outcome_fragments",
	"team_mailbox",
	"team_mission_log",
] as const;

function toIso(value: Date | string | undefined | null): string | null {
	if (value === undefined || value === null) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseJson<T>(raw: unknown, fallback: T): T {
	if (typeof raw !== "string" || raw.length === 0) return fallback;
	return safeJsonParse<T>(raw) ?? fallback;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function fullStateDelta(state: TeamRuntimeState): TeamRuntimeStateDelta {
	return {
		teamId: state.teamId,
		teamName: state.teamName,
		reset: true,
		members: state.members,
		tasks: state.tasks,
		mailbox: state.mailbox,
		missionLog: state.missionLog,
		runs: state.runs,
		outcomes: state.outcomes,
		outcomeFragments: state.outcomeFragments,
	};
}

export interface SqliteTeamStoreTuning {
	eventRetentionPerTeam?: number;
	eventRetentionMs?: number;
}

export class SqliteTeamStore implements TeamStore {
	private readonly teamDirPath: string;
	private db: SqliteDb | undefined;
	private readonly retentionPerTeam: number;
	private readonly retentionMs: number;

	constructor(options: SqliteTeamStoreOptions & SqliteTeamStoreTuning = {}) {
		this.teamDirPath = options.teamDir ?? defaultTeamDir();
		this.retentionPerTeam =
			options.eventRetentionPerTeam ?? TEAM_EVENT_RETENTION_PER_TEAM;
		this.retentionMs = options.eventRetentionMs ?? TEAM_EVENT_RETENTION_MS;
	}

	init(): void {
		this.getRawDb();
	}

	close(): void {
		this.db?.close?.();
		this.db = undefined;
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
		// Session/schedule schemas use separate migration paths in @cline/shared.
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
		const current = (
			db
				.prepare("SELECT version FROM team_store_schema_version WHERE lock = 1")
				.get() as { version: number } | null
		)?.version;
		if ((current ?? 1) < TEAM_STORE_SCHEMA_VERSION) {
			this.migrateToV2(db);
		} else if (
			db
				.prepare(
					"SELECT 1 FROM team_runtime_snapshot WHERE state_json != '' LIMIT 1",
				)
				.get()
		) {
			// `withTransaction` would re-enter `getRawDb` before `this.db` is set.
			db.exec("BEGIN IMMEDIATE;");
			try {
				this.importLegacySnapshots(db);
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
	}

	/**
	 * Moves any non-empty `state_json` into entity rows, then clears it.
	 * v2+ builds only ever write `''`, so a non-empty value was written by an
	 * older build (e.g. after an image rollback). Runs on every open, not just
	 * the v2 migration, so those writes are recovered after re-upgrading.
	 * Caller owns the transaction.
	 */
	private importLegacySnapshots(db: SqliteDb): void {
		const teamNames = db
			.prepare(
				"SELECT team_name FROM team_runtime_snapshot WHERE state_json != ''",
			)
			.all()
			.map((row) => str(row.team_name));
		for (const teamName of teamNames) {
			// Parse one snapshot at a time to bound memory on large stores.
			const row = db
				.prepare(
					"SELECT state_json FROM team_runtime_snapshot WHERE team_name = ?",
				)
				.get(teamName);
			const parsed = parseJson<TeamRuntimeState | undefined>(
				row?.state_json,
				undefined,
			);
			if (parsed) {
				this.writeDelta(
					db,
					teamName,
					fullStateDelta(reviveTeamRuntimeStateDates(parsed)),
				);
			}
			db.prepare(
				"UPDATE team_runtime_snapshot SET state_json = '' WHERE team_name = ?",
			).run(teamName);
		}
	}

	/**
	 * v2 migration (one-time, transactional):
	 * - adds `data_json` to entity tables and new members/mailbox/mission-log
	 *   tables, so state is rebuilt from rows instead of `state_json`;
	 * - moves each existing snapshot into rows, compacting run results;
	 * - deletes telemetry events and strips transcripts from retained ones;
	 * - clears `state_json` (the column stays for downgrade-safe schema).
	 * Run `vacuum()` afterwards to give the space back to the OS.
	 */
	private migrateToV2(db: SqliteDb): void {
		const addColumn = (table: string, column: string) => {
			const columns = db.prepare(`PRAGMA table_info(${table})`).all();
			if (!columns.some((c) => c.name === column)) {
				db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
			}
		};
		db.exec("BEGIN IMMEDIATE;");
		try {
			for (const table of [
				"team_tasks",
				"team_runs",
				"team_outcomes",
				"team_outcome_fragments",
			]) {
				addColumn(table, "data_json");
			}
			db.exec(`
				CREATE TABLE IF NOT EXISTS team_members (
					team_name TEXT PRIMARY KEY,
					team_id TEXT NOT NULL,
					members_json TEXT NOT NULL,
					updated_at TEXT NOT NULL
				);
			`);
			db.exec(`
				CREATE TABLE IF NOT EXISTS team_mailbox (
					team_name TEXT NOT NULL,
					message_id TEXT NOT NULL,
					data_json TEXT NOT NULL,
					PRIMARY KEY(team_name, message_id)
				);
			`);
			db.exec(`
				CREATE TABLE IF NOT EXISTS team_mission_log (
					team_name TEXT NOT NULL,
					entry_id TEXT NOT NULL,
					data_json TEXT NOT NULL,
					PRIMARY KEY(team_name, entry_id)
				);
			`);

			this.importLegacySnapshots(db);

			db.prepare(
				`DELETE FROM team_events WHERE event_type IN (${TELEMETRY_EVENT_TYPES.map(() => "?").join(",")})`,
			).run(...TELEMETRY_EVENT_TYPES);
			const heavyIds = db
				.prepare(
					"SELECT id FROM team_events WHERE event_type = 'task_end' OR event_type LIKE 'run_%'",
				)
				.all()
				.map((r) => r.id);
			const readEvent = db.prepare(
				"SELECT payload_json FROM team_events WHERE id = ?",
			);
			const writeEvent = db.prepare(
				"UPDATE team_events SET payload_json = ? WHERE id = ?",
			);
			for (const id of heavyIds) {
				const payload = parseJson<TeamEvent | undefined>(
					readEvent.get(id)?.payload_json,
					undefined,
				);
				if (payload && typeof payload === "object") {
					writeEvent.run(JSON.stringify(toPersistableTeamEvent(payload)), id);
				}
			}
			db.prepare(
				"UPDATE team_store_schema_version SET version = ? WHERE lock = 1",
			).run(TEAM_STORE_SCHEMA_VERSION);
			db.exec("COMMIT;");
		} catch (error) {
			try {
				db.exec("ROLLBACK;");
			} catch {
				// ignore secondary failure
			}
			throw error;
		}
		const teams = db
			.prepare("SELECT DISTINCT team_name FROM team_events")
			.all()
			.map((row) => str(row.team_name));
		for (const team of teams) {
			this.pruneTeamEvents(db, team);
		}
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
			`SELECT team_name FROM team_members ORDER BY team_name ASC`,
		).map((row) => row.team_name);
	}

	/** Rebuild state from per-entity rows. Cost is O(live entities). */
	readState(teamName: string): TeamRuntimeState | undefined {
		const safeTeamName = sanitizeTeamName(teamName);
		const header = this.queryOne<Row>(
			"SELECT team_id, members_json FROM team_members WHERE team_name = ?",
			[safeTeamName],
		);
		if (!header) {
			return undefined;
		}
		const rows = <T>(table: string, idColumn: string): T[] =>
			this.queryAll<Row>(
				`SELECT data_json FROM ${table} WHERE team_name = ? AND data_json IS NOT NULL ORDER BY ${idColumn}`,
				[safeTeamName],
			).flatMap((row) => {
				const value = parseJson<T | undefined>(row.data_json, undefined);
				return value === undefined ? [] : [value];
			});
		try {
			return reviveTeamRuntimeStateDates({
				teamId: str(header.team_id),
				teamName: safeTeamName,
				members: parseJson<TeamRuntimeState["members"]>(
					header.members_json,
					[],
				),
				tasks: rows("team_tasks", "task_id"),
				mailbox: rows("team_mailbox", "message_id"),
				missionLog: rows("team_mission_log", "entry_id"),
				runs: rows("team_runs", "run_id"),
				outcomes: rows("team_outcomes", "outcome_id"),
				outcomeFragments: rows("team_outcome_fragments", "fragment_id"),
			});
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
		return {
			state,
			teammates,
			interruptedRunIds: [],
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

	/**
	 * Incremental write: appends events and upserts only changed entities in
	 * one transaction. Cost is O(changes in batch), independent of history.
	 */
	persistBatch(teamName: string, batch: TeamPersistenceBatch): void {
		const safeTeamName = sanitizeTeamName(teamName);
		const db = this.getRawDb();
		this.withTransaction(() => {
			const ts = nowIso();
			const insert = db.prepare(
				`INSERT INTO team_events (team_name, ts, event_type, payload_json, causation_id, correlation_id)
				 VALUES (?, ?, ?, ?, NULL, NULL)`,
			);
			for (const event of batch.events) {
				insert.run(safeTeamName, ts, event.type, JSON.stringify(event.payload));
			}
			this.writeDelta(db, safeTeamName, batch.delta);
			this.writeTeammates(db, safeTeamName, batch.teammates);
		});
		if (batch.events.length > 0) {
			// The batch is committed; pruning is best-effort. Throwing here would
			// make the writer retry and re-append already-committed events.
			try {
				this.pruneTeamEvents(db, safeTeamName);
			} catch {
				// Retried on the next batch.
			}
		}
	}

	/** Full rewrite, expressed as a reset delta (no `state_json` blob). */
	persistRuntime(
		teamName: string,
		state: TeamRuntimeState,
		teammates: TeamTeammateSpec[],
	): void {
		const safeTeamName = sanitizeTeamName(teamName);
		const db = this.getRawDb();
		this.withTransaction(() => {
			this.writeDelta(db, safeTeamName, fullStateDelta(state));
			this.writeTeammates(db, safeTeamName, teammates);
		});
	}

	private writeTeammates(
		db: SqliteDb,
		safeTeamName: string,
		teammates: TeamTeammateSpec[],
	): void {
		db.prepare(
			`INSERT INTO team_runtime_snapshot (team_name, state_json, teammates_json, updated_at)
			 VALUES (?, '', ?, ?)
			 ON CONFLICT(team_name) DO UPDATE SET
				state_json = '',
				teammates_json = excluded.teammates_json,
				updated_at = excluded.updated_at`,
		).run(safeTeamName, JSON.stringify(teammates), nowIso());
	}

	private writeDelta(
		db: SqliteDb,
		safeTeamName: string,
		delta: TeamRuntimeStateDelta,
	): void {
		if (delta.reset) {
			for (const table of ENTITY_TABLES) {
				db.prepare(`DELETE FROM ${table} WHERE team_name = ?`).run(
					safeTeamName,
				);
			}
		}
		db.prepare(
			`INSERT INTO team_members (team_name, team_id, members_json, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(team_name) DO UPDATE SET
				team_id = excluded.team_id,
				members_json = excluded.members_json,
				updated_at = excluded.updated_at`,
		).run(safeTeamName, delta.teamId, JSON.stringify(delta.members), nowIso());

		if (delta.tasks.length > 0) {
			const stmt = db.prepare(
				`INSERT INTO team_tasks (team_name, task_id, title, description, status, assignee, depends_on_json, summary, version, updated_at, data_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
				 ON CONFLICT(team_name, task_id) DO UPDATE SET
					title = excluded.title,
					description = excluded.description,
					status = excluded.status,
					assignee = excluded.assignee,
					depends_on_json = excluded.depends_on_json,
					summary = excluded.summary,
					version = team_tasks.version + 1,
					updated_at = excluded.updated_at,
					data_json = excluded.data_json`,
			);
			for (const task of delta.tasks) {
				stmt.run(
					safeTeamName,
					task.id,
					task.title,
					task.description,
					task.status,
					task.assignee ?? null,
					JSON.stringify(task.dependsOn ?? []),
					task.summary ?? null,
					toIso(task.updatedAt) ?? nowIso(),
					JSON.stringify(task),
				);
			}
		}

		if (delta.runs.length > 0) {
			const stmt = db.prepare(
				`INSERT INTO team_runs (team_name, run_id, agent_id, task_id, status, message, started_at, ended_at, error, lease_owner, heartbeat_at, version, data_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
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
					version = team_runs.version + 1,
					data_json = excluded.data_json`,
			);
			for (const original of delta.runs) {
				// Defensive: never persist a full transcript on a run row.
				const run = {
					...original,
					result: toTeamRunResultRecord(original.result),
				};
				stmt.run(
					safeTeamName,
					run.id,
					run.agentId,
					run.taskId ?? null,
					run.status,
					run.message,
					toIso(run.startedAt),
					toIso(run.endedAt),
					run.error ?? null,
					run.leaseOwner ?? null,
					toIso(run.heartbeatAt),
					JSON.stringify(run),
				);
			}
		}

		if (delta.outcomes.length > 0) {
			const stmt = db.prepare(
				`INSERT INTO team_outcomes (team_name, outcome_id, title, status, schema_json, finalized_at, version, data_json)
				 VALUES (?, ?, ?, ?, ?, ?, 1, ?)
				 ON CONFLICT(team_name, outcome_id) DO UPDATE SET
					title = excluded.title,
					status = excluded.status,
					schema_json = excluded.schema_json,
					finalized_at = excluded.finalized_at,
					version = team_outcomes.version + 1,
					data_json = excluded.data_json`,
			);
			for (const outcome of delta.outcomes) {
				stmt.run(
					safeTeamName,
					outcome.id,
					outcome.title,
					outcome.status,
					JSON.stringify({ requiredSections: outcome.requiredSections }),
					toIso(outcome.finalizedAt),
					JSON.stringify(outcome),
				);
			}
		}

		if (delta.outcomeFragments.length > 0) {
			const stmt = db.prepare(
				`INSERT INTO team_outcome_fragments (team_name, outcome_id, fragment_id, section, source_agent_id, source_run_id, content, status, reviewed_by, reviewed_at, version, data_json)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
				 ON CONFLICT(team_name, fragment_id) DO UPDATE SET
					outcome_id = excluded.outcome_id,
					section = excluded.section,
					source_agent_id = excluded.source_agent_id,
					source_run_id = excluded.source_run_id,
					content = excluded.content,
					status = excluded.status,
					reviewed_by = excluded.reviewed_by,
					reviewed_at = excluded.reviewed_at,
					version = team_outcome_fragments.version + 1,
					data_json = excluded.data_json`,
			);
			for (const fragment of delta.outcomeFragments) {
				stmt.run(
					safeTeamName,
					fragment.outcomeId,
					fragment.id,
					fragment.section,
					fragment.sourceAgentId,
					fragment.sourceRunId ?? null,
					fragment.content,
					fragment.status,
					fragment.reviewedBy ?? null,
					toIso(fragment.reviewedAt),
					JSON.stringify(fragment),
				);
			}
		}

		const upsertBlob = (table: string, idColumn: string) =>
			db.prepare(
				`INSERT INTO ${table} (team_name, ${idColumn}, data_json) VALUES (?, ?, ?)
				 ON CONFLICT(team_name, ${idColumn}) DO UPDATE SET data_json = excluded.data_json`,
			);
		if (delta.mailbox.length > 0) {
			const stmt = upsertBlob("team_mailbox", "message_id");
			for (const message of delta.mailbox) {
				stmt.run(safeTeamName, message.id, JSON.stringify(message));
			}
		}
		if (delta.missionLog.length > 0) {
			const stmt = upsertBlob("team_mission_log", "entry_id");
			for (const entry of delta.missionLog) {
				stmt.run(safeTeamName, entry.id, JSON.stringify(entry));
			}
		}
	}

	/** Cap `team_events` per team by count and by age. */
	private pruneTeamEvents(db: SqliteDb, safeTeamName: string): void {
		const cutoff = new Date(Date.now() - this.retentionMs).toISOString();
		db.prepare("DELETE FROM team_events WHERE team_name = ? AND ts < ?").run(
			safeTeamName,
			cutoff,
		);
		const boundary = db
			.prepare(
				"SELECT id FROM team_events WHERE team_name = ? ORDER BY id DESC LIMIT 1 OFFSET ?",
			)
			.get(safeTeamName, this.retentionPerTeam);
		if (boundary && typeof boundary.id === "number") {
			db.prepare("DELETE FROM team_events WHERE team_name = ? AND id <= ?").run(
				safeTeamName,
				boundary.id,
			);
		}
	}

	/**
	 * Return free pages to the OS after the v2 migration or heavy pruning.
	 * VACUUM rewrites the whole file, so it is explicit, not automatic.
	 */
	vacuum(): void {
		this.getRawDb().exec("VACUUM;");
	}

	markInProgressRunsInterrupted(teamName: string, reason: string): string[] {
		const safeTeamName = sanitizeTeamName(teamName);
		const rows = this.queryAll<Row>(
			`SELECT run_id, data_json FROM team_runs WHERE team_name = ? AND status IN ('queued', 'running')`,
			[safeTeamName],
		);
		if (rows.length === 0) {
			return [];
		}
		const now = nowIso();
		this.withTransaction(() => {
			for (const row of rows) {
				const data = parseJson<Row | undefined>(row.data_json, undefined);
				const next = data
					? JSON.stringify({
							...data,
							status: "interrupted",
							error: reason,
							endedAt: now,
						})
					: null;
				this.run(
					`UPDATE team_runs SET status = 'interrupted', error = ?, ended_at = ?, version = version + 1,
					 data_json = COALESCE(?, data_json)
					 WHERE team_name = ? AND run_id = ?`,
					[reason, now, next, safeTeamName, str(row.run_id)],
				);
			}
		});
		return rows.map((row) => str(row.run_id));
	}

	/** Legacy single-event path: telemetry is dropped, payloads compacted. */
	handleTeamEvent(teamName: string, event: TeamEvent): void {
		if (!isDurableTeamEvent(event)) {
			return;
		}
		this.appendTeamEvent(teamName, event.type, toPersistableTeamEvent(event));
		this.pruneTeamEvents(this.getRawDb(), sanitizeTeamName(teamName));
	}
}
