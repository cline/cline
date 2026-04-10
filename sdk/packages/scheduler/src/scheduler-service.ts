import { randomUUID } from "node:crypto";
import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@clinebot/shared";
import { nowIso } from "@clinebot/shared/db";
import { assertValidCronPattern } from "./cron";
import { ResourceLimiter } from "./resource-limiter";
import { type ScheduleClaimRecord, ScheduleStore } from "./schedule-store";
import type {
	ActiveScheduledExecution,
	CreateScheduleInput,
	ListScheduleExecutionsOptions,
	ListSchedulesOptions,
	ScheduleAutonomousOptions,
	ScheduleExecutionRecord,
	ScheduleExecutionStatus,
	ScheduleRecord,
	SchedulerServiceOptions,
	UpdateScheduleInput,
} from "./types";

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function parseTurnMetrics(result: RpcChatTurnResult): {
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

const DEFAULT_AUTONOMOUS_IDLE_TIMEOUT_SECONDS = 60;
const DEFAULT_AUTONOMOUS_POLL_INTERVAL_SECONDS = 5;
const AUTONOMOUS_IDLE_NOOP_TOKEN = "<idle-noop/>";

interface AggregatedTurnMetrics {
	iterations?: number;
	tokensUsed?: number;
	costUsd?: number;
}

function addTurnMetrics(
	current: AggregatedTurnMetrics,
	result: RpcChatTurnResult,
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

function asPositiveSeconds(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.max(1, Math.floor(value));
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

function isAutonomousNoop(result: RpcChatTurnResult): boolean {
	return result.text?.trim() === AUTONOMOUS_IDLE_NOOP_TOKEN;
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
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

export class SchedulerService {
	private readonly store: ScheduleStore;
	private readonly resourceLimiter: ResourceLimiter;
	private readonly options: SchedulerServiceOptions;
	private readonly claimLeaseMs: number;
	private readonly activeExecutions = new Map<
		string,
		ActiveScheduledExecution
	>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private started = false;
	private ticking = false;

	constructor(options: SchedulerServiceOptions) {
		this.options = options;
		this.store = new ScheduleStore({ sessionsDbPath: options.sessionsDbPath });
		this.resourceLimiter = new ResourceLimiter(
			options.globalMaxConcurrency ?? 10,
		);
		this.claimLeaseMs = Math.max(
			5_000,
			optionsOrDefault(options.claimLeaseSeconds, 90) * 1000,
		);
	}

	public async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.started = true;
		const intervalMs = Math.max(
			5_000,
			optionsOrDefault(this.options.pollIntervalMs, 30_000),
		);
		this.options.logger?.log("scheduler.started", {
			pollIntervalMs: intervalMs,
		});
		await this.tick();
		this.timer = setInterval(() => {
			void this.tick();
		}, intervalMs);
	}

	public async stop(): Promise<void> {
		if (!this.started) {
			return;
		}
		this.started = false;
		this.options.logger?.log("scheduler.stopped", {});
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		const active = Array.from(this.activeExecutions.values());
		await Promise.all(
			active.map(async (execution) => {
				try {
					await this.options.runtimeHandlers.abortSession(execution.sessionId);
				} catch {
					// Best-effort abort during shutdown.
				}
			}),
		);
	}

	public createSchedule(input: CreateScheduleInput): ScheduleRecord {
		assertValidCronPattern(input.cronPattern);
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
		updates: UpdateScheduleInput,
	): ScheduleRecord | undefined {
		if (updates.cronPattern !== undefined) {
			assertValidCronPattern(updates.cronPattern);
		}
		const current = this.store.getSchedule(scheduleId);
		if (!current) {
			return undefined;
		}
		const nextWorkspaceRoot =
			updates.workspaceRoot !== undefined
				? updates.workspaceRoot.trim()
				: (current.workspaceRoot ?? "");
		const nextEnabled = updates.enabled ?? current.enabled;
		if (nextEnabled && !nextWorkspaceRoot) {
			throw new Error("workspaceRoot is required for enabled schedules");
		}
		return this.store.updateSchedule(scheduleId, updates);
	}

	public deleteSchedule(scheduleId: string): boolean {
		return this.store.deleteSchedule(scheduleId);
	}

	public pauseSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.updateSchedule(scheduleId, { enabled: false });
	}

	public resumeSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.updateSchedule(scheduleId, { enabled: true });
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

	public getScheduleStats(scheduleId: string) {
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
			const L = this.options.logger;
			if (L) {
				if (L.error) {
					L.error("scheduler.tick.failed", { error });
				} else {
					L.log("scheduler.tick.failed", { error, severity: "error" });
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
				claim.triggeredAt,
				"scheduled",
			);
			const completedAt = result.startedAt ?? claim.triggeredAt;
			const finalized = this.store.completeScheduleClaim(
				claim.schedule.scheduleId,
				claim.claimToken,
				completedAt,
			);
			if (!finalized) {
				this.publishEvent("schedule.execution.claimLost", {
					scheduleId: claim.schedule.scheduleId,
					executionId: result.executionId,
					claimToken: claim.claimToken,
				});
			}
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
		return () => {
			clearInterval(interval);
		};
	}

	private buildStartRequest(
		schedule: ScheduleRecord,
	): RpcChatStartSessionRequest {
		const workspaceRoot = schedule.workspaceRoot?.trim();
		if (!workspaceRoot) {
			throw new Error("schedule requires workspaceRoot");
		}
		const request: RpcChatStartSessionRequest = {
			workspaceRoot,
			cwd: schedule.cwd?.trim() || workspaceRoot,
			provider: schedule.provider,
			model: schedule.model,
			mode: schedule.mode,
			apiKey: "",
			systemPrompt: schedule.systemPrompt,
			maxIterations: schedule.maxIterations,
			enableTools: true,
			enableSpawn: true,
			enableTeams: true,
			autoApproveTools: true,
			teamName: `scheduled-${schedule.scheduleId}`,
			missionStepInterval: 3,
			missionTimeIntervalMs: 120000,
		};
		return request;
	}

	private async executeSchedule(
		schedule: ScheduleRecord,
		triggeredAt: string,
		trigger: "scheduled" | "manual",
	): Promise<ScheduleExecutionRecord> {
		const executionId = `exec_${randomUUID()}`;
		const pending: ScheduleExecutionRecord = {
			executionId,
			scheduleId: schedule.scheduleId,
			triggeredAt,
			status: "pending",
		};
		this.store.recordExecution(pending);

		const acquired = this.resourceLimiter.acquire(
			schedule.scheduleId,
			executionId,
			schedule.maxParallel,
		);
		if (!acquired) {
			const skipped: ScheduleExecutionRecord = {
				...pending,
				status: "failed",
				endedAt: nowIso(),
				errorMessage: "concurrency limit reached",
			};
			this.store.recordExecution(skipped);
			return skipped;
		}

		let sessionId: string | undefined;
		let startedAt: string | undefined;
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
			const activeSessionId = sessionId;
			const startedAtIso = nowIso();
			startedAt = startedAtIso;
			timeoutAt =
				typeof schedule.timeoutSeconds === "number" &&
				schedule.timeoutSeconds > 0
					? new Date(
							new Date(startedAtIso).getTime() + schedule.timeoutSeconds * 1000,
						).toISOString()
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
				startedAt: startedAtIso,
				timeoutAt,
			});
			this.publishEvent("schedule.execution.started", {
				scheduleId: schedule.scheduleId,
				executionId,
				sessionId,
				trigger,
				triggeredAt,
			});

			const turnRequest: RpcChatRunTurnRequest = {
				config: startRequest,
				prompt: buildSchedulePrompt(schedule, getAutonomousOptions(schedule)),
			};
			const sendTurn = async (
				request: RpcChatRunTurnRequest,
			): Promise<RpcChatTurnResult> => {
				const sendPromise = this.options.runtimeHandlers.sendSession(
					activeSessionId,
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
					sessionId: activeSessionId,
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
				endedAt: nowIso(),
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
						? new Date(completed.endedAt).getTime() -
							new Date(completed.startedAt).getTime()
						: undefined,
			});
			return completed;
		} catch (error) {
			const L = this.options.logger;
			const payload = {
				error,
				scheduleId: schedule.scheduleId,
				executionId,
				trigger,
			};
			if (L) {
				if (L.error) {
					L.error("schedule.execution.failed", payload);
				} else {
					L.log("schedule.execution.failed", {
						...payload,
						severity: "error",
					});
				}
			}
			const status: ScheduleExecutionStatus =
				error instanceof TimeoutError ? "timeout" : "failed";
			if (sessionId && status === "timeout") {
				try {
					await this.options.runtimeHandlers.abortSession(sessionId);
				} catch {
					// Best-effort timeout abort.
				}
			}
			const failed: ScheduleExecutionRecord = {
				executionId,
				scheduleId: schedule.scheduleId,
				sessionId,
				triggeredAt,
				startedAt,
				endedAt: nowIso(),
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
					// Best-effort stop.
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
		startRequest: RpcChatStartSessionRequest;
		autonomous: ScheduleAutonomousOptions;
		metrics: AggregatedTurnMetrics;
		sendTurn: (request: RpcChatRunTurnRequest) => Promise<RpcChatTurnResult>;
		executionDeadlineMs?: number;
	}): Promise<AggregatedTurnMetrics> {
		let metrics = options.metrics;
		const idleTimeoutSeconds =
			options.autonomous.idleTimeoutSeconds ??
			DEFAULT_AUTONOMOUS_IDLE_TIMEOUT_SECONDS;
		const pollIntervalSeconds =
			options.autonomous.pollIntervalSeconds ??
			DEFAULT_AUTONOMOUS_POLL_INTERVAL_SECONDS;
		let idleDeadlineMs = Date.now() + idleTimeoutSeconds * 1000;
		while (Date.now() < idleDeadlineMs) {
			const remainingIdleMs = Math.max(0, idleDeadlineMs - Date.now());
			const waitMs = Math.min(pollIntervalSeconds * 1000, remainingIdleMs);
			if (waitMs > 0) {
				if (options.executionDeadlineMs) {
					const remainingExecutionMs = options.executionDeadlineMs - Date.now();
					if (remainingExecutionMs <= 0) {
						throw new TimeoutError("scheduled execution timed out");
					}
					await sleep(Math.min(waitMs, remainingExecutionMs));
				} else {
					await sleep(waitMs);
				}
			}
			if (Date.now() >= idleDeadlineMs) {
				break;
			}
			const result = await options.sendTurn({
				config: options.startRequest,
				prompt: buildAutonomousPollPrompt(options.autonomous),
			});
			metrics = addTurnMetrics(metrics, result);
			if (!isAutonomousNoop(result)) {
				idleDeadlineMs = Date.now() + idleTimeoutSeconds * 1000;
			}
		}
		return metrics;
	}
}

function optionsOrDefault(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.floor(value);
}
