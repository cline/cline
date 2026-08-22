/**
 * Durable FIFO run queue with immediate acknowledgement.
 *
 * `run.enqueue` admits a prompt into this queue and acks immediately with
 * `{runId, acceptedAt, queuePosition}` — acceptance is decoupled from
 * execution, so the reply never blocks on the turn and never dies with the
 * socket. One run executes at a time per session, in admission order.
 *
 * Runs are durable: a daemon crash leaves `queued` rows to re-admit in FIFO
 * order at the next startup, and `running` rows are marked `interrupted` —
 * never silently resumed, never left dangling as ghost "running" state.
 *
 * Admission applies backpressure: a full per-session queue rejects with a
 * retryable `run_admission_rejected` instead of accepting unbounded work.
 */

import { join } from "node:path";
import { createSessionId } from "@cline/shared";
import { loadSqliteDb, type SqliteDb } from "@cline/shared/db";
import { resolveDbDataDir } from "@cline/shared/storage";

const DEFAULT_MAX_PENDING_PER_SESSION = 32;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type HubRunState =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "aborted"
	| "interrupted";

export interface HubRunRecord {
	runId: string;
	sessionId: string;
	state: HubRunState;
	/** The `run.start`-shaped payload to execute (prompt, mode, attachments, ...). */
	input: Record<string, unknown>;
	clientId?: string;
	acceptedAt: number;
	startedAt?: number;
	endedAt?: number;
	error?: string;
}

export interface HubRunAccepted {
	runId: string;
	acceptedAt: number;
	queuePosition: number;
}

export class HubRunAdmissionRejectedError extends Error {
	readonly retryable = true;

	constructor(sessionId: string, pending: number, limit: number) {
		super(
			`Session ${sessionId} queue is full (${pending} pending runs, limit ${limit}); retry later.`,
		);
		this.name = "HubRunAdmissionRejectedError";
	}
}

export interface HubRunQueueOptions {
	/** Database file. Defaults to an owner-scoped `<data>/db/hub-runs-*.db`; use ":memory:" in tests. */
	dbPath?: string;
	/** Scopes the default `dbPath`; ignored when `dbPath` is given. */
	ownerId?: string;
	maxPendingPerSession?: number;
}

/**
 * Default queue location, scoped per hub owner context: startup recovery
 * marks orphaned `running` rows interrupted, and a coexisting hub (dev
 * shared next to production) must never reap another hub's live runs.
 */
export function resolveHubRunQueuePath(ownerId?: string): string {
	const scope = ownerId?.replace(/[^a-zA-Z0-9_-]/g, "-");
	return join(
		resolveDbDataDir(),
		scope ? `hub-runs-${scope}.db` : "hub-runs.db",
	);
}

export class HubRunQueue {
	private readonly db: SqliteDb;
	private readonly maxPendingPerSession: number;
	private closed = false;

	constructor(options: HubRunQueueOptions = {}) {
		this.db = loadSqliteDb(
			options.dbPath ?? resolveHubRunQueuePath(options.ownerId),
		);
		this.maxPendingPerSession =
			options.maxPendingPerSession ?? DEFAULT_MAX_PENDING_PER_SESSION;
		// WAL + a busy timeout, matching the other SQLite stores: admissions
		// and state transitions must not serialize against run.list readers or
		// fail fast when another handle briefly holds the write lock.
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec("PRAGMA busy_timeout = 5000;");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS hub_runs (
				accepted_seq INTEGER PRIMARY KEY AUTOINCREMENT,
				run_id TEXT NOT NULL UNIQUE,
				session_id TEXT NOT NULL,
				state TEXT NOT NULL,
				input_json TEXT NOT NULL,
				client_id TEXT,
				accepted_at INTEGER NOT NULL,
				started_at INTEGER,
				ended_at INTEGER,
				error TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_hub_runs_session
				ON hub_runs(session_id, accepted_seq);
			CREATE INDEX IF NOT EXISTS idx_hub_runs_state
				ON hub_runs(state, accepted_seq);
		`);
	}

	/** Durable FIFO admission + immediate acknowledgement. */
	admit(
		sessionId: string,
		input: Record<string, unknown>,
		clientId?: string,
	): HubRunAccepted {
		const pendingAhead = this.countPendingBySession(sessionId);
		if (pendingAhead >= this.maxPendingPerSession) {
			throw new HubRunAdmissionRejectedError(
				sessionId,
				pendingAhead,
				this.maxPendingPerSession,
			);
		}
		const runId = createSessionId("hrun_");
		const acceptedAt = Date.now();
		this.db
			.prepare(
				`INSERT INTO hub_runs (run_id, session_id, state, input_json, client_id, accepted_at)
				 VALUES (?, ?, 'queued', ?, ?, ?);`,
			)
			.run(
				runId,
				sessionId,
				JSON.stringify(input),
				clientId ?? null,
				acceptedAt,
			);
		return { runId, acceptedAt, queuePosition: pendingAhead };
	}

	get(runId: string): HubRunRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM hub_runs WHERE run_id = ?;")
			.get(runId);
		return row ? toRecord(row) : undefined;
	}

	/** Oldest queued run for the session, if any. */
	nextQueued(sessionId: string): HubRunRecord | undefined {
		const row = this.db
			.prepare(
				`SELECT * FROM hub_runs WHERE session_id = ? AND state = 'queued'
				 ORDER BY accepted_seq LIMIT 1;`,
			)
			.get(sessionId);
		return row ? toRecord(row) : undefined;
	}

	/** Whether a run is currently marked running for the session. */
	hasRunning(sessionId: string): boolean {
		const row = this.db
			.prepare(
				"SELECT COUNT(*) AS n FROM hub_runs WHERE session_id = ? AND state = 'running';",
			)
			.get(sessionId);
		return Number(row?.n ?? 0) > 0;
	}

	countPendingBySession(sessionId: string): number {
		const row = this.db
			.prepare(
				`SELECT COUNT(*) AS n FROM hub_runs
				 WHERE session_id = ? AND state IN ('queued', 'running');`,
			)
			.get(sessionId);
		return Number(row?.n ?? 0);
	}

	countPending(): number {
		const row = this.db
			.prepare(
				"SELECT COUNT(*) AS n FROM hub_runs WHERE state IN ('queued', 'running');",
			)
			.get();
		return Number(row?.n ?? 0);
	}

	markRunning(runId: string): void {
		this.db
			.prepare(
				"UPDATE hub_runs SET state = 'running', started_at = ? WHERE run_id = ? AND state = 'queued';",
			)
			.run(Date.now(), runId);
	}

	markTerminal(
		runId: string,
		state: Extract<
			HubRunState,
			"completed" | "failed" | "aborted" | "interrupted"
		>,
		error?: string,
	): void {
		this.db
			.prepare(
				"UPDATE hub_runs SET state = ?, ended_at = ?, error = ? WHERE run_id = ?;",
			)
			.run(state, Date.now(), error ?? null, runId);
	}

	list(options: { sessionId?: string; limit?: number } = {}): HubRunRecord[] {
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (options.sessionId) {
			clauses.push("session_id = ?");
			params.push(options.sessionId);
		}
		params.push(options.limit ?? 100);
		return this.db
			.prepare(
				`SELECT * FROM hub_runs
				 ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
				 ORDER BY accepted_seq DESC LIMIT ?;`,
			)
			.all(...params)
			.map(toRecord);
	}

	/**
	 * Crash recovery, run once at daemon startup, before any new admission:
	 * runs left `running` by a dead daemon are marked `interrupted` (never
	 * auto-resumed — a resumed half-turn is worse than an honest interrupt),
	 * and committed `queued` runs are returned for FIFO re-admission.
	 */
	recoverOnStartup(): {
		interrupted: HubRunRecord[];
		requeued: HubRunRecord[];
	} {
		const interrupted = this.db
			.prepare(
				"SELECT * FROM hub_runs WHERE state = 'running' ORDER BY accepted_seq;",
			)
			.all()
			.map(toRecord);
		this.db
			.prepare(
				`UPDATE hub_runs SET state = 'interrupted', ended_at = ?,
				 error = 'Hub daemon exited before the run finished.'
				 WHERE state = 'running';`,
			)
			.run(Date.now());
		const requeued = this.db
			.prepare(
				"SELECT * FROM hub_runs WHERE state = 'queued' ORDER BY accepted_seq;",
			)
			.all()
			.map(toRecord);
		this.db
			.prepare(
				"DELETE FROM hub_runs WHERE ended_at IS NOT NULL AND ended_at < ?;",
			)
			.run(Date.now() - TERMINAL_RETENTION_MS);
		return {
			interrupted: interrupted.map((run) => ({
				...run,
				state: "interrupted" as const,
			})),
			requeued,
		};
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.db.close?.();
	}
}

function toRecord(row: Record<string, unknown>): HubRunRecord {
	let input: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(String(row.input_json));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			input = parsed as Record<string, unknown>;
		}
	} catch {
		// A corrupt input row still surfaces as a record; execution will fail it.
	}
	return {
		runId: String(row.run_id),
		sessionId: String(row.session_id),
		state: String(row.state) as HubRunState,
		input,
		clientId: typeof row.client_id === "string" ? row.client_id : undefined,
		acceptedAt: Number(row.accepted_at),
		startedAt: row.started_at === null ? undefined : Number(row.started_at),
		endedAt: row.ended_at === null ? undefined : Number(row.ended_at),
		error: typeof row.error === "string" ? row.error : undefined,
	};
}
