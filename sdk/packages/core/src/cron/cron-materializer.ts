import type { CronSpecRecord, SqliteCronStore } from "./sqlite-cron-store";

/**
 * Queue materialization rules shared between the reconciler, watcher, and
 * periodic runner tick. Execution stays trigger-agnostic once a row is
 * queued; this module is the only place that decides when to create a row.
 */

export interface CronMaterializerOptions {
	store: SqliteCronStore;
	now?: () => number;
}

export interface MaterializeSummary {
	oneOffQueued: number;
	scheduleQueued: number;
}

export class CronMaterializer {
	private readonly store: SqliteCronStore;
	private readonly nowFn: () => number;

	constructor(options: CronMaterializerOptions) {
		this.store = options.store;
		this.nowFn = options.now ?? (() => Date.now());
	}

	/**
	 * Run materialization for every valid/enabled spec. Typically called at
	 * startup (after reconciliation) and on each runner tick.
	 */
	public materializeAll(): MaterializeSummary {
		const summary: MaterializeSummary = {
			oneOffQueued: 0,
			scheduleQueued: 0,
		};

		const oneOffs = this.store.listSpecs({
			triggerKind: "one_off",
			enabled: true,
			parseStatus: "valid",
		});
		for (const spec of oneOffs) {
			if (this.materializeOneOff(spec)) summary.oneOffQueued += 1;
		}

		const schedules = this.store.listSpecs({
			triggerKind: "schedule",
			enabled: true,
			parseStatus: "valid",
		});
		for (const spec of schedules) {
			try {
				if (this.materializeSchedule(spec)) summary.scheduleQueued += 1;
			} catch {
				// Keep one stale/invalid persisted schedule from blocking other specs.
			}
		}

		return summary;
	}

	/**
	 * Ensure a single one-off spec has exactly one run record for its current
	 * revision unless an explicit rerun path creates a different trigger kind.
	 * Returns true if a new queued run was created.
	 */
	public materializeOneOff(spec: CronSpecRecord): boolean {
		if (spec.triggerKind !== "one_off") return false;
		if (!spec.enabled || spec.removed) return false;
		if (this.store.hasOneOffRunForRevision(spec.specId, spec.revision)) {
			return false;
		}
		this.store.enqueueRun({
			specId: spec.specId,
			specRevision: spec.revision,
			triggerKind: "one_off",
			scheduledFor: new Date(this.nowFn()).toISOString(),
		});
		return true;
	}

	/**
	 * Materialize schedule runs. Implements the "one overdue catch-up on
	 * startup, then advance" policy described in PLAN.md.
	 */
	public materializeSchedule(spec: CronSpecRecord): boolean {
		if (spec.triggerKind !== "schedule") return false;
		if (!spec.enabled || spec.removed) return false;
		if (!spec.scheduleExpr) return false;

		return this.store.materializeDueScheduleRun({
			specId: spec.specId,
			nowMs: this.nowFn(),
		}).queued;
	}
}
