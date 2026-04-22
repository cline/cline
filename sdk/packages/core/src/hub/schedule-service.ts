import { randomUUID } from "node:crypto";
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
import { nowIso } from "@clinebot/shared/db";
import { ResourceLimiter } from "./resource-limiter";
import { validateCronPattern } from "./scheduler";
import {
	type ListScheduleExecutionsOptions,
	type ListSchedulesOptions,
	type ScheduleClaimRecord,
	type ScheduleExecutionStats,
	SqliteHubScheduleStore,
} from "./sqlite-schedule-store";

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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

function parseTurnMetrics(result: HubScheduleTurnResult): {
	iterations?: number;
	tokensUsed?: number;
	costUsd?: number;
} {
	const inputTokens =
		typeof result.inputTokens === "number" ? result.inputTokens : undefined;
	const outputTokens =
		typeof result.outputTokens === "number" ? result.outputTokens : undefined;
	return {
		iterations:
			typeof result.iterations === "number" ? result.iterations : undefined,
		tokensUsed:
			inputTokens !== undefined && outputTokens !== undefined
				? inputTokens + outputTokens
				: undefined,
		costUsd:
			typeof result.usage?.totalCost === "number"
				? result.usage.totalCost
				: undefined,
	};
}

interface AggregatedTurnMetrics {
	iterations?: number;
	tokensUsed?: number;
	costUsd?: number;
}

function addTurnMetrics(
	current: AggregatedTurnMetrics,
	result: HubScheduleTurnResult,
): AggregatedTurnMetrics {
	const next = { ...current };
	const metrics = parseTurnMetrics(result);
	if (typeof metrics.iterations === "number") {
		next.iterations = (next.iterations ?? 0) + metrics.iterations;
	}
	if (typeof metrics.tokensUsed === "number") {
		next.tokensUsed = (next.tokensUsed ?? 0) + metrics.tokensUsed;
	}
	if (typeof metrics.costUsd === "number") {
		next.costUsd = (next.costUsd ?? 0) + metrics.costUsd;
	}
	return next;
}

function optionsOrDefault(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asPositiveSeconds(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.max(1, Math.floor(value));
}

const DEFAULT_AUTONOMOUS_IDLE_TIMEOUT_SECONDS = 60;
const DEFAULT_AUTONOMOUS_POLL_INTERVAL_SECONDS = 5;
const AUTONOMOUS_IDLE_NOOP_TOKEN = "<idle-noop/>";

export interface ScheduleAutonomousOptions {
	enabled?: boolean;
	idleTimeoutSeconds?: number;
	pollIntervalSeconds?: number;
}

function getAutonomousOptions(
	schedule: ScheduleRecord,
): ScheduleAutonomousOptions | undefined {
	const metadata = schedule.metadata;
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	const raw =
		metadata.autonomous &&
		typeof metadata.autonomous === "object" &&
		!Array.isArray(metadata.autonomous)
			? (metadata.autonomous as Record<string, unknown>)
			: undefined;
	if (!raw || raw.enabled !== true) {
		return undefined;
	}
	return {
		enabled: true,
		idleTimeoutSeconds: asPositiveSeconds(
			raw.idleTimeoutSeconds,
			DEFAULT_AUTONOMOUS_IDLE_TIMEOUT_SECONDS,
		),
		pollIntervalSeconds: asPositiveSeconds(
			raw.pollIntervalSeconds,
			DEFAULT_AUTONOMOUS_POLL_INTERVAL_SECONDS,
		),
	};
}

function buildSchedulePrompt(
	schedule: ScheduleRecord,
	autonomous: ScheduleAutonomousOptions | undefined,
): string {
	if (!autonomous?.enabled) {
		return schedule.prompt;
	}
	return `${schedule.prompt}

When you finish the immediate scheduled work, remain available for autonomous follow-up. During idle polling, inspect team mailbox and team tasks. Use team_task with action="list" to find ready unassigned work, claim it with team_task and action="claim", and resume execution when work exists. Reply exactly ${AUTONOMOUS_IDLE_NOOP_TOKEN} only when the poll finds no actionable work.`;
}

function buildAutonomousPollPrompt(
	autonomous: ScheduleAutonomousOptions,
): string {
	return `Autonomous idle poll. Check team_read_mailbox for unread messages and use team_task with action="list" to find ready unassigned tasks. Claim and execute one task if actionable work exists. If there is nothing to do right now, reply exactly ${AUTONOMOUS_IDLE_NOOP_TOKEN} and nothing else. Poll cadence is ${autonomous.pollIntervalSeconds}s and the idle shutdown window is ${autonomous.idleTimeoutSeconds}s.`;
}

function isAutonomousNoop(result: HubScheduleTurnResult): boolean {
	return result.text?.trim() === AUTONOMOUS_IDLE_NOOP_TOKEN;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimeoutError";
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	if (timeoutMs <= 0) {
		return await promise;
	}
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(() => {
			reject(new TimeoutError("scheduled execution timed out"));
		}, timeoutMs);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

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
	sessionsDbPath?: string;
	pollIntervalMs?: number;
	globalMaxConcurrency?: number;
	claimLeaseSeconds?: number;
}

export class HubScheduleService {
	private readonly store: SqliteHubScheduleStore;
	private readonly resourceLimiter: ResourceLimiter;
	private readonly options: HubScheduleServiceOptions;
	private readonly claimLeaseMs: number;
	private readonly activeExecutions = new Map<
		string,
		ActiveScheduledExecution
	>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private started = false;
	private ticking = false;
	private disposed = false;

	constructor(options: HubScheduleServiceOptions) {
		this.options = options;
		this.store = new SqliteHubScheduleStore({
			sessionsDbPath: options.sessionsDbPath,
		});
		this.resourceLimiter = new ResourceLimiter(
			options.globalMaxConcurrency ?? 10,
		);
		this.claimLeaseMs = Math.max(
			5_000,
			optionsOrDefault(options.claimLeaseSeconds, 90) * 1000,
		);
	}

	public async start(): Promise<void> {
		if (this.disposed) {
			throw new Error("HubScheduleService has been disposed");
		}
		if (this.started) {
			return;
		}
		this.started = true;
		const intervalMs = Math.max(
			5_000,
			optionsOrDefault(this.options.pollIntervalMs, 30_000),
		);
		this.options.logger?.log("hub.schedule.started", {
			pollIntervalMs: intervalMs,
		});
		await this.tick();
		this.timer = setInterval(() => {
			void this.tick();
		}, intervalMs);
	}

	public async stop(): Promise<void> {
		const wasStarted = this.started;
		this.started = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		if (wasStarted) {
			this.options.logger?.log("hub.schedule.stopped", {});
		}
		const active = Array.from(this.activeExecutions.values());
		await Promise.all(
			active.map(async (execution) => {
				try {
					await this.options.runtimeHandlers.abortSession(execution.sessionId);
				} catch {
					// best effort
				}
			}),
		);
	}

	public async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		await this.stop();
		this.store.close();
	}

	public createSchedule(input: HubScheduleCreateInput): ScheduleRecord {
		validateCronPattern(input.cronPattern);
		if (!input.workspaceRoot?.trim()) {
			throw new Error("workspaceRoot is required for schedules");
		}
		return this.store.createSchedule(input);
	}

	public getSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.store.getSchedule(scheduleId);
	}

	public listSchedules(options: ListSchedulesOptions = {}): ScheduleRecord[] {
		return this.store.listSchedules(options);
	}

	public updateSchedule(
		scheduleId: string,
		updates: HubScheduleUpdateInput,
	): ScheduleRecord | undefined {
		if (updates.cronPattern !== undefined) {
			validateCronPattern(updates.cronPattern);
		}
		const current = this.store.getSchedule(scheduleId);
		if (!current) {
			return undefined;
		}
		const nextWorkspaceRoot =
			updates.workspaceRoot !== undefined
				? updates.workspaceRoot.trim()
				: current.workspaceRoot;
		const nextEnabled = updates.enabled ?? current.enabled;
		if (nextEnabled && !nextWorkspaceRoot) {
			throw new Error("workspaceRoot is required for enabled schedules");
		}
		return this.store.updateSchedule(scheduleId, {
			...updates,
			scheduleId,
		});
	}

	public deleteSchedule(scheduleId: string): boolean {
		return this.store.deleteSchedule(scheduleId);
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
		const schedule = this.store.getSchedule(scheduleId);
		if (!schedule) {
			return undefined;
		}
		return await this.executeSchedule(schedule, nowIso(), "manual");
	}

	public listScheduleExecutions(
		options: ListScheduleExecutionsOptions,
	): ScheduleExecutionRecord[] {
		return this.store.listExecutions(options);
	}

	public getScheduleStats(scheduleId: string): ScheduleExecutionStats {
		return this.store.getExecutionStats(scheduleId);
	}

	public getActiveExecutions(): ActiveScheduledExecution[] {
		return Array.from(this.activeExecutions.values());
	}

	public getUpcomingRuns(limit = 20): Array<{
		scheduleId: string;
		name: string;
		nextRunAt: string;
	}> {
		return this.store.listUpcomingRuns(limit);
	}

	private async tick(): Promise<void> {
		if (this.ticking) {
			return;
		}
		this.ticking = true;
		try {
			const claims = this.store.claimDueSchedules(nowIso(), this.claimLeaseMs);
			await Promise.allSettled(
				claims.map((claim) => this.executeClaimedSchedule(claim)),
			);
		} catch (error) {
			const logger = this.options.logger;
			if (logger) {
				if (logger.error) {
					logger.error("hub.schedule.tick.failed", { error });
				} else {
					logger.log("hub.schedule.tick.failed", {
						error,
						severity: "error",
					});
				}
			}
		} finally {
			this.ticking = false;
		}
	}

	private async executeClaimedSchedule(
		claim: ScheduleClaimRecord,
	): Promise<void> {
		const releaseLeaseHeartbeat = this.startClaimLeaseHeartbeat(claim);
		try {
			const result = await this.executeSchedule(
				claim.schedule,
				new Date(claim.triggeredAt).toISOString(),
				"scheduled",
			);
			const completedAt = result.startedAt ?? claim.triggeredAt;
			this.store.completeScheduleClaim(
				claim.schedule.scheduleId,
				claim.claimToken,
				new Date(completedAt).toISOString(),
			);
		} finally {
			releaseLeaseHeartbeat();
		}
	}

	private startClaimLeaseHeartbeat(claim: ScheduleClaimRecord): () => void {
		const heartbeatMs = Math.max(1_000, Math.floor(this.claimLeaseMs / 2));
		const interval = setInterval(() => {
			const leaseUntilAt = new Date(
				Date.now() + this.claimLeaseMs,
			).toISOString();
			const renewed = this.store.renewScheduleClaim(
				claim.schedule.scheduleId,
				claim.claimToken,
				leaseUntilAt,
			);
			if (!renewed) {
				clearInterval(interval);
			}
		}, heartbeatMs);
		return () => clearInterval(interval);
	}

	private buildStartRequest(schedule: ScheduleRecord): ChatStartSessionRequest {
		const workspaceRoot = schedule.workspaceRoot.trim();
		const provider = schedule.modelSelection?.providerId?.trim();
		const model = schedule.modelSelection?.modelId?.trim();
		if (!workspaceRoot) {
			throw new Error("schedule requires workspaceRoot");
		}
		if (!provider || !model) {
			throw new Error(
				"schedule requires modelSelection.providerId and modelSelection.modelId",
			);
		}
		return {
			workspaceRoot,
			cwd: schedule.cwd?.trim() || workspaceRoot,
			provider,
			model,
			mode:
				schedule.mode === "plan"
					? "plan"
					: schedule.mode === "yolo"
						? "yolo"
						: "act",
			apiKey: "",
			systemPrompt: schedule.systemPrompt,
			maxIterations: schedule.maxIterations,
			enableTools: schedule.runtimeOptions?.enableTools ?? true,
			enableSpawn: schedule.runtimeOptions?.enableSpawn ?? true,
			enableTeams: schedule.runtimeOptions?.enableTeams ?? true,
			autoApproveTools: schedule.runtimeOptions?.autoApproveTools ?? true,
		};
	}

	private async executeSchedule(
		schedule: ScheduleRecord,
		triggeredAt: string,
		trigger: "scheduled" | "manual",
	): Promise<ScheduleExecutionRecord> {
		const executionId = `exec_${randomUUID()}`;
		const triggeredAtMs = new Date(triggeredAt).getTime();
		const pending: ScheduleExecutionRecord = {
			executionId,
			scheduleId: schedule.scheduleId,
			triggeredAt: triggeredAtMs,
			status: "pending",
		};
		this.store.recordExecution(pending);

		const acquired = this.resourceLimiter.acquire(
			schedule.scheduleId,
			executionId,
			schedule.maxParallel ?? 1,
		);
		if (!acquired) {
			const skipped: ScheduleExecutionRecord = {
				...pending,
				status: "failed",
				endedAt: Date.now(),
				errorMessage: "concurrency limit reached",
			};
			this.store.recordExecution(skipped);
			return skipped;
		}

		let sessionId: string | undefined;
		let startedAt: number | undefined;
		let timeoutAt: string | undefined;
		let executionDeadlineMs: number | undefined;

		try {
			const startRequest = this.buildStartRequest(schedule);
			const startResponse =
				await this.options.runtimeHandlers.startSession(startRequest);
			sessionId = startResponse.sessionId.trim();
			if (!sessionId) {
				throw new Error("runtime start returned empty sessionId");
			}

			startedAt = Date.now();
			timeoutAt =
				typeof schedule.timeoutSeconds === "number" &&
				schedule.timeoutSeconds > 0
					? new Date(startedAt + schedule.timeoutSeconds * 1000).toISOString()
					: undefined;
			executionDeadlineMs = timeoutAt
				? new Date(timeoutAt).getTime()
				: undefined;

			const runningState: ScheduleExecutionRecord = {
				...pending,
				sessionId,
				startedAt,
				status: "running",
			};
			this.store.recordExecution(runningState);
			this.activeExecutions.set(executionId, {
				executionId,
				scheduleId: schedule.scheduleId,
				sessionId,
				startedAt: new Date(startedAt).toISOString(),
				timeoutAt,
			});
			this.publishEvent("schedule.execution.started", {
				scheduleId: schedule.scheduleId,
				executionId,
				sessionId,
				trigger,
				triggeredAt,
			});

			const turnRequest: ChatRunTurnRequest = {
				config: startRequest,
				prompt: buildSchedulePrompt(schedule, getAutonomousOptions(schedule)),
			};
			const sendTurn = async (
				request: ChatRunTurnRequest,
			): Promise<HubScheduleTurnResult> => {
				const sendPromise = this.options.runtimeHandlers.sendSession(
					sessionId!,
					request,
				);
				const timeoutMs = executionDeadlineMs
					? Math.max(1, executionDeadlineMs - Date.now())
					: 0;
				const sendResult = await withTimeout(sendPromise, timeoutMs);
				return sendResult.result;
			};

			let metrics = addTurnMetrics({}, await sendTurn(turnRequest));
			const autonomous = getAutonomousOptions(schedule);
			if (autonomous?.enabled) {
				metrics = await this.runAutonomousIdleLoop({
					sessionId,
					startRequest,
					autonomous,
					metrics,
					sendTurn,
					executionDeadlineMs,
				});
			}

			const completed: ScheduleExecutionRecord = {
				...runningState,
				status: "success",
				endedAt: Date.now(),
				iterations: metrics.iterations,
				tokensUsed: metrics.tokensUsed,
				costUsd: metrics.costUsd,
			};
			this.store.recordExecution(completed);
			this.publishEvent("schedule.execution.completed", {
				scheduleId: schedule.scheduleId,
				executionId,
				sessionId,
				status: completed.status,
				durationMs:
					completed.startedAt && completed.endedAt
						? completed.endedAt - completed.startedAt
						: undefined,
			});
			return completed;
		} catch (error) {
			const status: ScheduleExecutionStatus =
				error instanceof TimeoutError ? "timeout" : "failed";
			if (sessionId && status === "timeout") {
				try {
					await this.options.runtimeHandlers.abortSession(sessionId);
				} catch {
					// best effort
				}
			}
			const failed: ScheduleExecutionRecord = {
				executionId,
				scheduleId: schedule.scheduleId,
				sessionId,
				triggeredAt: triggeredAtMs,
				startedAt,
				endedAt: Date.now(),
				status,
				errorMessage: toErrorMessage(error),
			};
			this.store.recordExecution(failed);
			this.publishEvent("schedule.execution.completed", {
				scheduleId: schedule.scheduleId,
				executionId,
				sessionId,
				status: failed.status,
				errorMessage: failed.errorMessage,
			});
			return failed;
		} finally {
			if (sessionId) {
				try {
					await this.options.runtimeHandlers.stopSession(sessionId);
				} catch {
					// best effort
				}
			}
			this.activeExecutions.delete(executionId);
			this.resourceLimiter.release(schedule.scheduleId, executionId);
		}
	}

	private publishEvent(eventType: string, payload: unknown): void {
		this.options.eventPublisher?.(eventType, payload);
	}

	private async runAutonomousIdleLoop(options: {
		sessionId: string;
		startRequest: ChatStartSessionRequest;
		autonomous: ScheduleAutonomousOptions;
		metrics: AggregatedTurnMetrics;
		sendTurn: (request: ChatRunTurnRequest) => Promise<HubScheduleTurnResult>;
		executionDeadlineMs?: number;
	}): Promise<AggregatedTurnMetrics> {
		let metrics = options.metrics;
		const idleDeadline =
			Date.now() + options.autonomous.idleTimeoutSeconds! * 1000;
		while (Date.now() < idleDeadline) {
			if (
				options.executionDeadlineMs !== undefined &&
				Date.now() >= options.executionDeadlineMs
			) {
				throw new TimeoutError("scheduled execution timed out");
			}
			await sleep(options.autonomous.pollIntervalSeconds! * 1000);
			const result = await options.sendTurn({
				config: options.startRequest,
				prompt: buildAutonomousPollPrompt(options.autonomous),
			});
			metrics = addTurnMetrics(metrics, result);
			if (isAutonomousNoop(result)) {
				break;
			}
		}
		return metrics;
	}
}
