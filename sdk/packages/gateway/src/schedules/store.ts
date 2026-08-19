/**
 * Schedule persistence (Gateway RFC, Phase 6).
 *
 * The Gateway owns triggers, durable claims, retries, and reports:
 *
 * - `schedules` holds the trigger definition (one-shot `at` or recurring
 *   `intervalMs`) and its next due time.
 * - `schedule_jobs` are the durable claim + report rows: one row per
 *   firing, claimed by exactly one Gateway instance with an expiring
 *   claim. An expired claim (the claiming worker died) recovers the SAME
 *   job row — if a run was already admitted it is adopted, never
 *   replaced, so no replacement session or duplicate run is created.
 */

import type { BotId, RunId, ScheduleId } from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";

export interface ScheduleRecord {
	readonly scheduleId: ScheduleId;
	readonly botId: BotId;
	readonly name: string;
	readonly prompt: string;
	/** Recurring trigger. */
	readonly intervalMs?: number;
	/** One-shot trigger (epoch ms). */
	readonly at?: number;
	readonly nextDueAt?: number;
	readonly enabled: boolean;
	/** Total run attempts per firing (1 = no retry). */
	readonly maxAttempts: number;
	readonly createdAt: number;
	readonly revision: number;
}

function rowToSchedule(row: Record<string, unknown>): ScheduleRecord {
	return {
		scheduleId: String(row.schedule_id) as ScheduleId,
		botId: String(row.bot_id) as BotId,
		name: String(row.name),
		prompt: String(row.prompt),
		intervalMs: row.interval_ms === null ? undefined : Number(row.interval_ms),
		at: row.at === null ? undefined : Number(row.at),
		nextDueAt: row.next_due_at === null ? undefined : Number(row.next_due_at),
		enabled: Number(row.enabled) === 1,
		maxAttempts: Number(row.max_attempts),
		createdAt: Number(row.created_at),
		revision: Number(row.revision),
	};
}

export class ScheduleStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	get(scheduleId: ScheduleId): ScheduleRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM schedules WHERE schedule_id = ?;")
			.get(scheduleId);
		return row ? rowToSchedule(row) : undefined;
	}

	list(botId?: BotId): readonly ScheduleRecord[] {
		if (botId) {
			return this.database.db
				.prepare(
					"SELECT * FROM schedules WHERE bot_id = ? ORDER BY created_at, schedule_id;",
				)
				.all(botId)
				.map(rowToSchedule);
		}
		return this.database.db
			.prepare("SELECT * FROM schedules ORDER BY created_at, schedule_id;")
			.all()
			.map(rowToSchedule);
	}

	/** Enabled schedules due at or before `now`. */
	listDue(now: number): readonly ScheduleRecord[] {
		return this.database.db
			.prepare(
				"SELECT * FROM schedules WHERE enabled = 1 AND next_due_at IS NOT NULL AND next_due_at <= ? ORDER BY next_due_at;",
			)
			.all(now)
			.map(rowToSchedule);
	}

	save(record: ScheduleRecord): void {
		this.database.db
			.prepare(
				`INSERT INTO schedules (
					schedule_id, bot_id, name, prompt, interval_ms, at,
					next_due_at, enabled, max_attempts, created_at, revision
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(schedule_id) DO UPDATE SET
					name = excluded.name,
					prompt = excluded.prompt,
					interval_ms = excluded.interval_ms,
					at = excluded.at,
					next_due_at = excluded.next_due_at,
					enabled = excluded.enabled,
					max_attempts = excluded.max_attempts,
					revision = excluded.revision;`,
			)
			.run(
				record.scheduleId,
				record.botId,
				record.name,
				record.prompt,
				record.intervalMs ?? null,
				record.at ?? null,
				record.nextDueAt ?? null,
				record.enabled ? 1 : 0,
				record.maxAttempts,
				record.createdAt,
				record.revision,
			);
	}

	advanceNextDue(scheduleId: ScheduleId, nextDueAt: number | undefined): void {
		this.database.db
			.prepare("UPDATE schedules SET next_due_at = ? WHERE schedule_id = ?;")
			.run(nextDueAt ?? null, scheduleId);
	}
}

// -----------------------------------------------------------------------------
// Jobs: durable claims + reports
// -----------------------------------------------------------------------------

export type ScheduleJobState = "pending" | "claimed" | "completed" | "failed";

export interface ScheduleJobRecord {
	readonly jobId: number;
	readonly scheduleId: ScheduleId;
	readonly dueAt: number;
	readonly state: ScheduleJobState;
	readonly claimedBy?: string;
	readonly claimExpiresAt?: number;
	readonly attempts: number;
	readonly runId?: RunId;
	readonly lastError?: string;
	readonly createdAt: number;
	readonly settledAt?: number;
}

function rowToJob(row: Record<string, unknown>): ScheduleJobRecord {
	return {
		jobId: Number(row.job_id),
		scheduleId: String(row.schedule_id) as ScheduleId,
		dueAt: Number(row.due_at),
		state: String(row.state) as ScheduleJobState,
		claimedBy: row.claimed_by === null ? undefined : String(row.claimed_by),
		claimExpiresAt:
			row.claim_expires_at === null ? undefined : Number(row.claim_expires_at),
		attempts: Number(row.attempts),
		runId: row.run_id === null ? undefined : (String(row.run_id) as RunId),
		lastError: row.last_error === null ? undefined : String(row.last_error),
		createdAt: Number(row.created_at),
		settledAt: row.settled_at === null ? undefined : Number(row.settled_at),
	};
}

export class ScheduleJobStore {
	private readonly database: GatewayDatabase;

	constructor(database: GatewayDatabase) {
		this.database = database;
	}

	/** Materialize the job row for one firing (idempotent per due time). */
	ensureJob(scheduleId: ScheduleId, dueAt: number, now: number): void {
		this.database.db
			.prepare(
				`INSERT INTO schedule_jobs (schedule_id, due_at, state, created_at)
				VALUES (?, ?, 'pending', ?)
				ON CONFLICT(schedule_id, due_at) DO NOTHING;`,
			)
			.run(scheduleId, dueAt, now);
	}

	get(jobId: number): ScheduleJobRecord | undefined {
		const row = this.database.db
			.prepare("SELECT * FROM schedule_jobs WHERE job_id = ?;")
			.get(jobId);
		return row ? rowToJob(row) : undefined;
	}

	/** Jobs claimable now: pending, or claimed with an expired claim. */
	listClaimable(now: number, limit: number): readonly ScheduleJobRecord[] {
		return this.database.db
			.prepare(
				`SELECT * FROM schedule_jobs
				WHERE state = 'pending' OR (state = 'claimed' AND claim_expires_at < ?)
				ORDER BY due_at, job_id LIMIT ?;`,
			)
			.all(now, limit)
			.map(rowToJob);
	}

	/**
	 * Claim a job for one instance. Conditional write: only a pending job
	 * or an expired claim can be taken, so two instances can never hold
	 * the same firing.
	 */
	claim(
		jobId: number,
		instanceId: string,
		now: number,
		claimTtlMs: number,
	): boolean {
		const result = this.database.db
			.prepare(
				`UPDATE schedule_jobs
				SET state = 'claimed', claimed_by = ?, claim_expires_at = ?
				WHERE job_id = ?
					AND (state = 'pending' OR (state = 'claimed' AND claim_expires_at < ?));`,
			)
			.run(instanceId, now + claimTtlMs, jobId, now);
		return Boolean(result.changes);
	}

	renewClaim(
		jobId: number,
		instanceId: string,
		now: number,
		ttlMs: number,
	): void {
		this.database.db
			.prepare(
				"UPDATE schedule_jobs SET claim_expires_at = ? WHERE job_id = ? AND claimed_by = ?;",
			)
			.run(now + ttlMs, jobId, instanceId);
	}

	/** Record the run this firing admitted (adopted on claim recovery). */
	recordRun(jobId: number, runId: RunId): void {
		this.database.db
			.prepare(
				"UPDATE schedule_jobs SET run_id = ?, attempts = attempts + 1 WHERE job_id = ?;",
			)
			.run(runId, jobId);
	}

	/** Count a failed admission attempt (no run was created). */
	incrementAttempts(jobId: number): void {
		this.database.db
			.prepare(
				"UPDATE schedule_jobs SET attempts = attempts + 1 WHERE job_id = ?;",
			)
			.run(jobId);
	}

	/** Return a claimed job to pending for an explicit retry. */
	returnForRetry(jobId: number, error: string): void {
		this.database.db
			.prepare(
				`UPDATE schedule_jobs
				SET state = 'pending', claimed_by = NULL, claim_expires_at = NULL,
					run_id = NULL, last_error = ?
				WHERE job_id = ?;`,
			)
			.run(error, jobId);
	}

	settle(
		jobId: number,
		state: "completed" | "failed",
		now: number,
		error?: string,
	): void {
		this.database.db
			.prepare(
				`UPDATE schedule_jobs
				SET state = ?, settled_at = ?, last_error = ?, claimed_by = NULL, claim_expires_at = NULL
				WHERE job_id = ?;`,
			)
			.run(state, now, error ?? null, jobId);
	}

	/** Unsettled jobs currently claimed by one instance. */
	listClaimedBy(instanceId: string): readonly ScheduleJobRecord[] {
		return this.database.db
			.prepare(
				"SELECT * FROM schedule_jobs WHERE state = 'claimed' AND claimed_by = ? ORDER BY due_at, job_id;",
			)
			.all(instanceId)
			.map(rowToJob);
	}

	/** Report rows for a schedule (newest first). */
	report(scheduleId: ScheduleId, limit = 100): readonly ScheduleJobRecord[] {
		return this.database.db
			.prepare(
				"SELECT * FROM schedule_jobs WHERE schedule_id = ? ORDER BY due_at DESC, job_id DESC LIMIT ?;",
			)
			.all(scheduleId, limit)
			.map(rowToJob);
	}
}
