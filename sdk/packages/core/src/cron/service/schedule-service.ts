import type {
	BasicLogger,
	ChatRunTurnRequest,
	ChatStartSessionArtifacts,
	ChatStartSessionRequest,
	HubScheduleCreateInput,
	HubScheduleUpdateInput,
	ScheduleExecutionRecord,
	ScheduleExecutionStatus,
	ScheduleRecord,
} from "@clinebot/shared";
import { CronMaterializer } from "../runner/cron-materializer";
import { CronRunner } from "../runner/cron-runner";
import { validateCronPattern } from "../schedule/scheduler";
import {
	type CronRunRecord,
	type CronSpecRecord,
	type ListRunsOptions,
	type ListSpecsOptions,
	SqliteCronStore,
} from "../store/sqlite-cron-store";

type HubScheduleTurnResult = {
	text: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
	inputTokens?: number;
	outputTokens?: number;
	iterations?: number;
	finishReason?: string;
	messages?: unknown[];
	toolCalls?: Array<{
		name: string;
		input?: unknown;
		output?: unknown;
		error?: string;
		durationMs?: number;
	}>;
};

export interface HubScheduleRuntimeHandlers {
	startSession(request: ChatStartSessionRequest): Promise<{
		sessionId: string;
		startResult?: ChatStartSessionArtifacts;
	}>;
	sendSession(
		sessionId: string,
		request: ChatRunTurnRequest,
	): Promise<{
		result: HubScheduleTurnResult;
	}>;
	abortSession(sessionId: string): Promise<{ applied: boolean }>;
	stopSession(sessionId: string): Promise<{ applied: boolean }>;
}

export interface ActiveScheduledExecution {
	executionId: string;
	scheduleId: string;
	sessionId: string;
	startedAt: string;
	timeoutAt?: string;
}

export interface HubScheduleServiceOptions {
	runtimeHandlers: HubScheduleRuntimeHandlers;
	eventPublisher?: (eventType: string, payload: unknown) => void;
	logger?: BasicLogger;
	dbPath?: string;
	pollIntervalMs?: number;
	globalMaxConcurrency?: number;
	claimLeaseSeconds?: number;
}

export interface ListSchedulesOptions {
	enabled?: boolean;
	limit?: number;
	tags?: string[];
}

export interface ListScheduleExecutionsOptions {
	scheduleId?: string;
	status?: ScheduleExecutionStatus;
	limit?: number;
}

export interface ScheduleExecutionStats {
	totalRuns: number;
	successRate: number;
	avgDurationSeconds: number;
	lastFailure?: ScheduleExecutionRecord;
}

function toMillis(value: string | undefined): number | undefined {
	return value ? new Date(value).getTime() : undefined;
}

function scheduleMetadata(
	spec: CronSpecRecord,
): Record<string, unknown> | undefined {
	const metadata = spec.metadata ? { ...spec.metadata } : undefined;
	if (metadata) {
		delete metadata.__hubScheduleCreatedBy;
		delete metadata.__hubScheduleCwd;
		delete metadata.__hubRuntimeOptions;
	}
	return metadata;
}

function specToSchedule(spec: CronSpecRecord): ScheduleRecord {
	const metadata = spec.metadata;
	return {
		scheduleId: spec.externalId,
		name: spec.title,
		cronPattern: spec.scheduleExpr ?? "",
		prompt: spec.prompt ?? "",
		workspaceRoot: spec.workspaceRoot ?? "",
		cwd:
			typeof metadata?.__hubScheduleCwd === "string"
				? metadata.__hubScheduleCwd
				: undefined,
		modelSelection:
			spec.providerId || spec.modelId
				? {
						providerId: spec.providerId ?? "",
						modelId: spec.modelId ?? "",
					}
				: undefined,
		enabled: spec.enabled && !spec.removed && spec.parseStatus === "valid",
		mode: spec.mode === "plan" ? "plan" : spec.mode === "yolo" ? "yolo" : "act",
		systemPrompt: spec.systemPrompt,
		maxIterations: spec.maxIterations,
		timeoutSeconds: spec.timeoutSeconds,
		maxParallel: spec.maxParallel ?? 1,
		createdAt: new Date(spec.createdAt).getTime(),
		updatedAt: new Date(spec.updatedAt).getTime(),
		nextRunAt: toMillis(spec.nextRunAt),
		lastRunAt: toMillis(spec.lastRunAt),
		createdBy:
			typeof metadata?.__hubScheduleCreatedBy === "string"
				? metadata.__hubScheduleCreatedBy
				: undefined,
		tags: spec.tags,
		runtimeOptions:
			metadata?.__hubRuntimeOptions &&
			typeof metadata.__hubRuntimeOptions === "object" &&
			!Array.isArray(metadata.__hubRuntimeOptions)
				? (metadata.__hubRuntimeOptions as ScheduleRecord["runtimeOptions"])
				: undefined,
		metadata: scheduleMetadata(spec) as ScheduleRecord["metadata"],
	};
}

function runStatusToScheduleStatus(
	status: CronRunRecord["status"],
): ScheduleExecutionStatus {
	switch (status) {
		case "done":
			return "success";
		case "cancelled":
			return "aborted";
		case "running":
			return "running";
		case "queued":
			return "pending";
		default:
			return "failed";
	}
}

function runToExecution(
	run: CronRunRecord,
	scheduleId: string,
): ScheduleExecutionRecord {
	return {
		executionId: run.runId,
		scheduleId,
		sessionId: run.sessionId,
		triggeredAt: new Date(run.scheduledFor ?? run.createdAt).getTime(),
		startedAt: toMillis(run.startedAt),
		endedAt: toMillis(run.completedAt),
		status: runStatusToScheduleStatus(run.status),
		errorMessage: run.error,
	};
}

export class HubScheduleService {
	private readonly store: SqliteCronStore;
	private readonly materializer: CronMaterializer;
	private readonly runner: CronRunner;
	private started = false;
	private disposed = false;

	constructor(options: HubScheduleServiceOptions) {
		this.store = new SqliteCronStore({
			dbPath: options.dbPath,
		});
		this.materializer = new CronMaterializer({ store: this.store });
		this.runner = new CronRunner({
			store: this.store,
			materializer: this.materializer,
			runtimeHandlers: options.runtimeHandlers,
			workspaceRoot: "",
			logger: options.logger,
			pollIntervalMs: options.pollIntervalMs,
			claimLeaseSeconds: options.claimLeaseSeconds,
			globalMaxConcurrency: options.globalMaxConcurrency,
		});
	}

	public async start(): Promise<void> {
		if (this.disposed) throw new Error("HubScheduleService has been disposed");
		if (this.started) return;
		this.started = true;
		await this.runner.start();
	}

	public async stop(): Promise<void> {
		await this.runner.stop();
		this.started = false;
	}

	public async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.runner.dispose();
		this.store.close();
	}

	public createSchedule(input: HubScheduleCreateInput): ScheduleRecord {
		validateCronPattern(input.cronPattern);
		if (!input.workspaceRoot?.trim()) {
			throw new Error("workspaceRoot is required for schedules");
		}
		return specToSchedule(this.store.createHubSchedule(input));
	}

	public getSchedule(scheduleId: string): ScheduleRecord | undefined {
		const spec = this.store.getHubSchedule(scheduleId);
		return spec ? specToSchedule(spec) : undefined;
	}

	public listSchedules(options: ListSchedulesOptions = {}): ScheduleRecord[] {
		return this.store
			.listHubSchedules(options)
			.map((spec) => specToSchedule(spec));
	}

	public updateSchedule(
		scheduleId: string,
		updates: HubScheduleUpdateInput,
	): ScheduleRecord | undefined {
		if (updates.cronPattern !== undefined) {
			validateCronPattern(updates.cronPattern);
		}
		const current = this.store.getHubSchedule(scheduleId);
		if (!current) return undefined;
		const nextWorkspaceRoot =
			updates.workspaceRoot !== undefined
				? updates.workspaceRoot.trim()
				: current.workspaceRoot;
		const nextEnabled = updates.enabled ?? current.enabled;
		if (nextEnabled && !nextWorkspaceRoot) {
			throw new Error("workspaceRoot is required for enabled schedules");
		}
		const updated = this.store.updateHubSchedule(scheduleId, {
			...updates,
			scheduleId,
		});
		return updated ? specToSchedule(updated) : undefined;
	}

	public deleteSchedule(scheduleId: string): boolean {
		return this.store.deleteHubSchedule(scheduleId);
	}

	public pauseSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.updateSchedule(scheduleId, { scheduleId, enabled: false });
	}

	public resumeSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.updateSchedule(scheduleId, { scheduleId, enabled: true });
	}

	public async triggerScheduleNow(
		scheduleId: string,
	): Promise<ScheduleExecutionRecord | undefined> {
		const run = this.store.enqueueHubScheduleRun(scheduleId, "manual");
		if (!run) return undefined;
		await this.runner.tick();
		const completed = this.store.getRun(run.runId) ?? run;
		return runToExecution(completed, scheduleId);
	}

	public listScheduleExecutions(
		options: ListScheduleExecutionsOptions,
	): ScheduleExecutionRecord[] {
		const spec = options.scheduleId
			? this.store.getHubSchedule(options.scheduleId)
			: undefined;
		const runOptions: ListRunsOptions = {
			specId: spec?.specId,
			limit: options.limit,
		};
		const runs = this.store.listRuns(runOptions);
		return runs
			.map((run) => {
				const runSpec = spec ?? this.store.getSpec(run.specId);
				if (!runSpec || runSpec.source !== "hub-schedule") return undefined;
				return runToExecution(run, runSpec.externalId);
			})
			.filter((record): record is ScheduleExecutionRecord => {
				if (!record) return false;
				return !options.status || record.status === options.status;
			});
	}

	public getScheduleStats(scheduleId: string): ScheduleExecutionStats {
		const all = this.listScheduleExecutions({ scheduleId, limit: 10_000 });
		if (all.length === 0) {
			return { totalRuns: 0, successRate: 0, avgDurationSeconds: 0 };
		}
		let success = 0;
		let withDuration = 0;
		let durationMsTotal = 0;
		let lastFailure: ScheduleExecutionRecord | undefined;
		for (const execution of all) {
			if (execution.status === "success" || execution.status === "completed") {
				success += 1;
			}
			if (
				!lastFailure &&
				execution.status !== "success" &&
				execution.status !== "completed"
			) {
				lastFailure = execution;
			}
			if (execution.startedAt && execution.endedAt) {
				durationMsTotal += execution.endedAt - execution.startedAt;
				withDuration += 1;
			}
		}
		return {
			totalRuns: all.length,
			successRate: success / all.length,
			avgDurationSeconds:
				withDuration > 0 ? durationMsTotal / withDuration / 1000 : 0,
			lastFailure,
		};
	}

	public getActiveExecutions(): ActiveScheduledExecution[] {
		return this.runner.getActiveRuns().flatMap((run) => {
			const spec = this.store.getSpec(run.specId);
			if (!spec || spec.source !== "hub-schedule" || !run.sessionId) return [];
			return [
				{
					executionId: run.runId,
					scheduleId: spec.externalId,
					sessionId: run.sessionId,
					startedAt: run.startedAt ?? new Date().toISOString(),
					timeoutAt:
						spec.timeoutSeconds && run.startedAt
							? new Date(
									new Date(run.startedAt).getTime() +
										spec.timeoutSeconds * 1000,
								).toISOString()
							: undefined,
				},
			];
		});
	}

	public getUpcomingRuns(limit = 20): Array<{
		scheduleId: string;
		name: string;
		nextRunAt: string;
	}> {
		const options: ListSpecsOptions = {
			triggerKind: "schedule",
			enabled: true,
			limit,
		};
		return this.store
			.listSpecs(options)
			.flatMap((spec) =>
				spec.source === "hub-schedule" && spec.nextRunAt
					? [{ spec, nextRunAt: spec.nextRunAt }]
					: [],
			)
			.sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)))
			.slice(0, limit)
			.map(({ spec, nextRunAt }) => ({
				scheduleId: spec.externalId,
				name: spec.title,
				nextRunAt,
			}));
	}
}
