import type { AutomationEventEnvelope, BasicLogger } from "@cline/shared";
import type { ResolveCronSpecsDirOptions } from "@cline/shared/storage";
import {
	CronEventIngress,
	type CronEventIngressResult,
} from "../events/cron-event-ingress";
import { CronMaterializer } from "../runner/cron-materializer";
import { CronRunner } from "../runner/cron-runner";
import { CronReconciler } from "../specs/cron-reconciler";
import { CronWatcher } from "../specs/cron-watcher";
import type {
	CronRunRecord,
	CronSpecRecord,
	ListEventLogsOptions,
	ListRunsOptions,
	ListSpecsOptions,
} from "../store/sqlite-cron-store";
import { SqliteCronStore } from "../store/sqlite-cron-store";
import type { HubScheduleRuntimeHandlers } from "./schedule-service";

/**
 * Top-level orchestrator for file-based cron automation.
 *
 * Wires together:
 *   - `SqliteCronStore` (cron.db)
 *   - `CronReconciler` (disk -> DB)
 *   - `CronWatcher` (cron specs directory filesystem events)
 *   - `CronMaterializer` (queue materialization)
 *   - `CronRunner` (claim + execute + report)
 *
 * This service is the forward path: the legacy `HubScheduleService`
 * continues to serve programmatic schedules, while `CronService` handles
 * everything sourced from the configured file-based cron directory.
 */

export interface CronServiceOptions {
	/** Default runtime workspace for the hub/daemon process. */
	workspaceRoot: string;
	/** Cron spec source/report location. Defaults to global `~/.cline/cron`. */
	specs?: ResolveCronSpecsDirOptions;
	runtimeHandlers: HubScheduleRuntimeHandlers;
	dbPath?: string;
	logger?: BasicLogger;
	pollIntervalMs?: number;
	claimLeaseSeconds?: number;
	globalMaxConcurrency?: number;
	watcherDebounceMs?: number;
}

export class CronService {
	private readonly store: SqliteCronStore;
	private readonly reconciler: CronReconciler;
	private readonly watcher: CronWatcher;
	private readonly eventIngress: CronEventIngress;
	private readonly materializer: CronMaterializer;
	private readonly runner: CronRunner;
	private started = false;
	private disposed = false;

	constructor(options: CronServiceOptions) {
		this.store = new SqliteCronStore({ dbPath: options.dbPath });
		const specs = options.specs;
		this.reconciler = new CronReconciler({
			store: this.store,
			specs,
		});
		this.materializer = new CronMaterializer({ store: this.store });
		this.eventIngress = new CronEventIngress({
			store: this.store,
			logger: options.logger,
		});
		this.runner = new CronRunner({
			store: this.store,
			materializer: this.materializer,
			runtimeHandlers: options.runtimeHandlers,
			workspaceRoot: options.workspaceRoot,
			specs,
			logger: options.logger,
			pollIntervalMs: options.pollIntervalMs,
			claimLeaseSeconds: options.claimLeaseSeconds,
			globalMaxConcurrency: options.globalMaxConcurrency,
		});
		this.watcher = new CronWatcher({
			reconciler: this.reconciler,
			debounceMs: options.watcherDebounceMs,
			onReconciled: () => {
				this.materializer.materializeAll();
			},
			onError: (err) => {
				const log = options.logger;
				if (log) {
					if (log.error) log.error("cron.watcher.failed", { error: err });
					else log.log("cron.watcher.failed", { error: err });
				}
			},
		});
	}

	public async start(): Promise<void> {
		if (this.disposed) throw new Error("CronService disposed");
		if (this.started) return;
		this.started = true;
		await this.reconciler.reconcileAll();
		this.materializer.materializeAll();
		this.watcher.start();
		await this.runner.start();
	}

	public async stop(): Promise<void> {
		this.watcher.stop();
		await this.runner.stop();
		this.started = false;
	}

	public async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.watcher.dispose();
		await this.runner.dispose();
		this.store.close();
	}

	public listSpecs(options?: ListSpecsOptions): CronSpecRecord[] {
		return this.store.listSpecs(options);
	}

	public getSpec(specId: string): CronSpecRecord | undefined {
		return this.store.getSpec(specId);
	}

	public listRuns(options?: ListRunsOptions): CronRunRecord[] {
		return this.store.listRuns(options);
	}

	public getRun(runId: string): CronRunRecord | undefined {
		return this.store.getRun(runId);
	}

	public listActiveRuns(): CronRunRecord[] {
		return this.store.listRuns({ status: "running", limit: 200 });
	}

	public listUpcomingRuns(limit = 20): CronRunRecord[] {
		return this.store.listRuns({ status: "queued", limit });
	}

	public async reconcileNow(): Promise<void> {
		await this.reconciler.reconcileAll();
		this.materializer.materializeAll();
	}

	public ingestEvent(event: AutomationEventEnvelope): CronEventIngressResult {
		return this.eventIngress.ingestEvent(event);
	}

	public listEventLogs(options?: ListEventLogsOptions) {
		return this.store.listEventLogs(options);
	}

	public getEventLog(eventId: string) {
		return this.store.getEventLog(eventId);
	}
}
