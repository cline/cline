/**
 * Scheduler (Gateway RFC, Phase 6).
 *
 * Turns due schedules into ordinary runs with explicit `automation`
 * provenance, through the same admission path (and the same per-session
 * FIFO queue) every other client uses. The Gateway instance that holds
 * the singleton lock is the only claimer; claims are durable rows with
 * an expiry, so a firing claimed by a died instance recovers on the next
 * tick — and if that firing had already admitted a run, the run is
 * adopted, never replaced (no duplicate run, no replacement session).
 */

import type { RunRecord } from "@cline/bot";
import type { RunAccepted } from "@cline/shared/gateway";
import { isTerminalRunState } from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";
import type { GatewayStores } from "../stores";
import { nextCronDueAt } from "./cron";
import type { ScheduleJobRecord, ScheduleRecord } from "./store";

export interface ScheduleOutcomeNotification {
	readonly schedule: ScheduleRecord;
	readonly jobId: number;
	readonly state: "completed" | "failed";
	readonly runId?: string;
	/** Completed: the run's output; failed: the error text. */
	readonly summary: string;
}

export interface SchedulerOptions {
	database: GatewayDatabase;
	stores: GatewayStores;
	/** Admit one automation run for a schedule (runtime-backed). */
	admitAutomationRun: (schedule: ScheduleRecord) => RunAccepted;
	/**
	 * Deliver a firing's outcome to the schedule's notify target
	 * (connector route). Wired to the ConnectorMessenger by the server;
	 * called once per settled firing, only for schedules with a target.
	 */
	notifyOutcome?: (notification: ScheduleOutcomeNotification) => void;
	instanceId: string;
	clock?: () => number;
	claimTtlMs?: number;
	/** Timer cadence; 0 disables the timer (tests call tick()). */
	tickIntervalMs?: number;
	maxJobsPerTick?: number;
	telemetry?: (event: Record<string, unknown>) => void;
}

export interface SchedulerTickReport {
	readonly materialized: number;
	readonly claimed: number;
	readonly admitted: number;
	readonly adopted: number;
	readonly settled: number;
	readonly retried: number;
}

export class Scheduler {
	private readonly options: SchedulerOptions;
	private readonly clock: () => number;
	private readonly telemetry: (event: Record<string, unknown>) => void;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(options: SchedulerOptions) {
		this.options = options;
		this.clock = options.clock ?? (() => Date.now());
		this.telemetry = options.telemetry ?? (() => {});
	}

	start(): void {
		const interval = this.options.tickIntervalMs ?? 1_000;
		if (interval > 0 && !this.timer) {
			this.timer = setInterval(() => {
				try {
					this.tick();
				} catch (error) {
					this.telemetry({
						kind: "scheduler.tickFailed",
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}, interval);
			this.timer.unref?.();
		}
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	/** One scheduling pass. Deterministic; tests drive it directly. */
	tick(now: number = this.clock()): SchedulerTickReport {
		const report = {
			materialized: 0,
			claimed: 0,
			admitted: 0,
			adopted: 0,
			settled: 0,
			retried: 0,
		};
		this.materializeDueJobs(now, report);
		this.claimAndAdmit(now, report);
		this.watchClaimedRuns(now, report);
		return report;
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	/** Turn due triggers into durable job rows and advance the trigger. */
	private materializeDueJobs(
		now: number,
		report: { materialized: number },
	): void {
		this.options.database.transaction(() => {
			for (const schedule of this.options.stores.schedules.listDue(now)) {
				const dueAt = schedule.nextDueAt ?? now;
				this.options.stores.scheduleJobs.ensureJob(
					schedule.scheduleId,
					dueAt,
					now,
				);
				report.materialized += 1;
				if (schedule.cronPattern) {
					this.options.stores.schedules.advanceNextDue(
						schedule.scheduleId,
						nextCronDueAt(schedule.cronPattern, now),
					);
				} else if (schedule.intervalMs && schedule.intervalMs > 0) {
					// Missed firings coalesce into the one just materialized;
					// the next due time is always in the future.
					let next = dueAt + schedule.intervalMs;
					while (next <= now) {
						next += schedule.intervalMs;
					}
					this.options.stores.schedules.advanceNextDue(
						schedule.scheduleId,
						next,
					);
				} else {
					// One-shot: no further firings.
					this.options.stores.schedules.advanceNextDue(
						schedule.scheduleId,
						undefined,
					);
				}
			}
		});
	}

	/** Claim pending/expired jobs; admit or adopt their runs. */
	private claimAndAdmit(
		now: number,
		report: {
			claimed: number;
			admitted: number;
			adopted: number;
			settled: number;
			retried: number;
		},
	): void {
		const claimTtlMs = this.options.claimTtlMs ?? 60_000;
		const claimable = this.options.stores.scheduleJobs.listClaimable(
			now,
			this.options.maxJobsPerTick ?? 16,
		);
		for (const job of claimable) {
			const claimed = this.options.database.transaction(() =>
				this.options.stores.scheduleJobs.claim(
					job.jobId,
					this.options.instanceId,
					now,
					claimTtlMs,
				),
			);
			if (!claimed) {
				continue;
			}
			report.claimed += 1;
			const fresh = this.options.stores.scheduleJobs.get(job.jobId);
			if (!fresh) {
				continue;
			}
			if (fresh.runId) {
				// Expired-claim recovery: the firing already admitted a run.
				// Adopt it — never create a replacement session or run.
				report.adopted += 1;
				this.settleFromRun(fresh, now, report);
				continue;
			}
			this.admit(fresh, now, report);
		}
	}

	private admit(
		job: ScheduleJobRecord,
		now: number,
		report: { admitted: number; settled: number; retried: number },
	): void {
		const schedule = this.options.stores.schedules.get(job.scheduleId);
		if (!schedule) {
			this.options.stores.scheduleJobs.settle(
				job.jobId,
				"failed",
				now,
				"Schedule no longer exists",
			);
			return;
		}
		try {
			const accepted = this.options.database.transaction(() => {
				const result = this.options.admitAutomationRun(schedule);
				this.options.stores.scheduleJobs.recordRun(job.jobId, result.runId);
				return result;
			});
			report.admitted += 1;
			this.telemetry({
				kind: "scheduler.runAdmitted",
				scheduleId: schedule.scheduleId,
				jobId: job.jobId,
				runId: accepted.runId,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.options.stores.scheduleJobs.incrementAttempts(job.jobId);
			const updated = this.options.stores.scheduleJobs.get(job.jobId) ?? {
				...job,
				attempts: job.attempts + 1,
			};
			this.retryOrFail(updated, now, `Admission failed: ${message}`, report);
		}
	}

	/** Settle claimed jobs whose runs reached a terminal state. */
	private watchClaimedRuns(
		now: number,
		report: { settled: number; retried: number },
	): void {
		const claimTtlMs = this.options.claimTtlMs ?? 60_000;
		for (const job of this.options.stores.scheduleJobs.listClaimedBy(
			this.options.instanceId,
		)) {
			if (!job.runId) {
				continue;
			}
			const settledOrRetried = this.settleFromRun(job, now, report);
			if (!settledOrRetried) {
				this.options.stores.scheduleJobs.renewClaim(
					job.jobId,
					this.options.instanceId,
					now,
					claimTtlMs,
				);
			}
		}
	}

	/** Returns true when the job settled or was returned for retry. */
	private settleFromRun(
		job: ScheduleJobRecord,
		now: number,
		report: { settled: number; retried: number },
	): boolean {
		if (!job.runId) {
			return false;
		}
		const run: RunRecord | undefined = this.options.stores.runs.get(job.runId);
		if (!run) {
			this.options.stores.scheduleJobs.settle(
				job.jobId,
				"failed",
				now,
				`Run ${job.runId} disappeared`,
			);
			report.settled += 1;
			return true;
		}
		if (!isTerminalRunState(run.state)) {
			return false;
		}
		if (run.state === "completed") {
			this.options.stores.scheduleJobs.settle(job.jobId, "completed", now);
			report.settled += 1;
			this.notifySettled(job, "completed", run.outputText ?? "");
			return true;
		}
		this.retryOrFail(
			job,
			now,
			run.error?.message ?? `Run ended ${run.state}`,
			report,
		);
		return true;
	}

	private retryOrFail(
		job: ScheduleJobRecord,
		now: number,
		error: string,
		report: { settled: number; retried: number },
	): void {
		const schedule = this.options.stores.schedules.get(job.scheduleId);
		const maxAttempts = schedule?.maxAttempts ?? 1;
		if (job.attempts < maxAttempts) {
			// Retry is explicit: a fresh attempt gets a fresh run, recorded
			// on the same job row.
			this.options.stores.scheduleJobs.returnForRetry(job.jobId, error);
			report.retried += 1;
			this.telemetry({
				kind: "scheduler.jobRetried",
				scheduleId: job.scheduleId,
				jobId: job.jobId,
				attempts: job.attempts,
			});
			return;
		}
		this.options.stores.scheduleJobs.settle(job.jobId, "failed", now, error);
		report.settled += 1;
		this.notifySettled(job, "failed", error);
		this.telemetry({
			kind: "scheduler.jobFailed",
			scheduleId: job.scheduleId,
			jobId: job.jobId,
			error,
		});
	}

	/** Schedule/event notifications to connector routes (Phase 6). */
	private notifySettled(
		job: ScheduleJobRecord,
		state: "completed" | "failed",
		summary: string,
	): void {
		if (!this.options.notifyOutcome) {
			return;
		}
		const schedule = this.options.stores.schedules.get(job.scheduleId);
		if (!schedule?.notify) {
			return;
		}
		try {
			this.options.notifyOutcome({
				schedule,
				jobId: job.jobId,
				state,
				runId: job.runId,
				summary,
			});
		} catch (error) {
			// A notification failure never fails the firing itself.
			this.telemetry({
				kind: "scheduler.notifyFailed",
				scheduleId: job.scheduleId,
				jobId: job.jobId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
