import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@clinebot/shared";
import {
	beforeEach,
	describe,
	expect,
	it,
	type MockedFunction,
	vi,
} from "vitest";
import { SchedulerService } from "./scheduler-service";
import type {
	CreateScheduleInput,
	ListScheduleExecutionsOptions,
	ListSchedulesOptions,
	ScheduleExecutionRecord,
	ScheduleExecutionStats,
	ScheduleRecord,
	UpdateScheduleInput,
} from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

const storeState = vi.hoisted(() => ({
	schedules: new Map<string, ScheduleRecord>(),
	executions: new Map<string, ScheduleExecutionRecord>(),
}));

function computeNextRun(enabled: boolean): string | undefined {
	return enabled ? new Date(Date.now() + 60_000).toISOString() : undefined;
}

vi.mock("./schedule-store", () => ({
	ScheduleStore: class MockScheduleStore {
		public createSchedule(input: CreateScheduleInput): ScheduleRecord {
			const createdAt = nowIso();
			const record: ScheduleRecord = {
				scheduleId: `sched_${crypto.randomUUID()}`,
				name: input.name.trim(),
				cronPattern: input.cronPattern.trim(),
				prompt: input.prompt,
				provider: input.provider,
				model: input.model,
				mode: input.mode ?? "act",
				workspaceRoot: input.workspaceRoot,
				cwd: input.cwd,
				systemPrompt: input.systemPrompt,
				maxIterations: input.maxIterations,
				timeoutSeconds: input.timeoutSeconds,
				maxParallel: input.maxParallel ?? 1,
				enabled: input.enabled !== false,
				createdAt,
				updatedAt: createdAt,
				lastRunAt: undefined,
				nextRunAt: computeNextRun(input.enabled !== false),
				createdBy: input.createdBy,
				tags: input.tags,
				metadata: input.metadata,
			};
			storeState.schedules.set(record.scheduleId, record);
			return record;
		}

		public getSchedule(scheduleId: string): ScheduleRecord | undefined {
			return storeState.schedules.get(scheduleId);
		}

		public listSchedules(options: ListSchedulesOptions = {}): ScheduleRecord[] {
			let records = Array.from(storeState.schedules.values());
			if (typeof options.enabled === "boolean") {
				records = records.filter((item) => item.enabled === options.enabled);
			}
			const limit = options.limit ?? 200;
			return records.slice(0, limit);
		}

		public updateSchedule(
			scheduleId: string,
			updates: UpdateScheduleInput,
		): ScheduleRecord | undefined {
			const current = storeState.schedules.get(scheduleId);
			if (!current) {
				return undefined;
			}
			const nextEnabled = updates.enabled ?? current.enabled;
			const next: ScheduleRecord = {
				...current,
				...updates,
				maxIterations:
					updates.maxIterations === null
						? undefined
						: (updates.maxIterations ?? current.maxIterations),
				timeoutSeconds:
					updates.timeoutSeconds === null
						? undefined
						: (updates.timeoutSeconds ?? current.timeoutSeconds),
				createdBy:
					updates.createdBy === null
						? undefined
						: (updates.createdBy ?? current.createdBy),
				enabled: nextEnabled,
				nextRunAt: computeNextRun(nextEnabled),
				updatedAt: nowIso(),
			};
			storeState.schedules.set(scheduleId, next);
			return next;
		}

		public deleteSchedule(scheduleId: string): boolean {
			return storeState.schedules.delete(scheduleId);
		}

		public claimDueSchedules(
			_referenceTime: string,
			_leaseMs: number,
		): Array<{
			schedule: ScheduleRecord;
			claimToken: string;
			triggeredAt: string;
			leaseUntilAt: string;
		}> {
			return [];
		}

		public renewScheduleClaim(
			_scheduleId: string,
			_claimToken: string,
			_leaseUntilAt: string,
		): boolean {
			return true;
		}

		public releaseScheduleClaim(
			_scheduleId: string,
			_claimToken: string,
		): boolean {
			return true;
		}

		public completeScheduleClaim(
			_scheduleId: string,
			_claimToken: string,
			_triggeredAt: string,
		): boolean {
			return true;
		}

		public recordExecution(execution: ScheduleExecutionRecord): void {
			storeState.executions.set(execution.executionId, execution);
		}

		public listExecutions(
			options: ListScheduleExecutionsOptions,
		): ScheduleExecutionRecord[] {
			let executions = Array.from(storeState.executions.values());
			if (options.scheduleId) {
				executions = executions.filter(
					(item) => item.scheduleId === options.scheduleId,
				);
			}
			if (options.status) {
				executions = executions.filter(
					(item) => item.status === options.status,
				);
			}
			const limit = options.limit ?? 50;
			return executions.slice(0, limit);
		}

		public getExecutionStats(scheduleId: string): ScheduleExecutionStats {
			const all = this.listExecutions({ scheduleId, limit: 10_000 });
			if (all.length === 0) {
				return {
					totalRuns: 0,
					successRate: 0,
					avgDurationSeconds: 0,
				};
			}
			const successCount = all.filter(
				(item) => item.status === "success",
			).length;
			return {
				totalRuns: all.length,
				successRate: successCount / all.length,
				avgDurationSeconds: 0,
				lastFailure: all.find((item) => item.status !== "success"),
			};
		}

		public listUpcomingRuns(limit = 20): Array<{
			scheduleId: string;
			name: string;
			nextRunAt: string;
		}> {
			return Array.from(storeState.schedules.values())
				.filter((item) => item.enabled && !!item.nextRunAt)
				.slice(0, Math.max(1, Math.floor(limit)))
				.map((item) => ({
					scheduleId: item.scheduleId,
					name: item.name,
					nextRunAt: item.nextRunAt as string,
				}));
		}
	},
}));

interface RuntimeBehavior {
	neverResolveSend?: boolean;
	sendResults?: RpcChatTurnResult[];
}

interface SchedulerHarness {
	service: SchedulerService;
	startSession: MockedFunction<
		(
			request: RpcChatStartSessionRequest,
		) => Promise<{ sessionId: string; startResult?: undefined }>
	>;
	sendSession: MockedFunction<
		(
			sessionId: string,
			request: RpcChatRunTurnRequest,
		) => Promise<{ result: RpcChatTurnResult }>
	>;
	abortSession: MockedFunction<
		(sessionId: string) => Promise<{ applied: boolean }>
	>;
	stopSession: MockedFunction<
		(sessionId: string) => Promise<{ applied: boolean }>
	>;
}

const baseScheduleInput = {
	name: "Routine schedule",
	cronPattern: "* * * * *",
	prompt: "Say hello",
	provider: "cline",
	model: "openai/gpt-5.3-codex",
	mode: "act" as const,
	workspaceRoot: "/tmp/workspace",
	maxParallel: 1,
};

let sessionCounter = 0;

function successResult(): RpcChatTurnResult {
	return {
		text: "done",
		iterations: 2,
		inputTokens: 7,
		outputTokens: 3,
		usage: {
			inputTokens: 7,
			outputTokens: 3,
			totalCost: 0.42,
		},
		finishReason: "end_turn",
		messages: [],
		toolCalls: [],
	};
}

function createHarness(behavior: RuntimeBehavior = {}): SchedulerHarness {
	const startSession = vi.fn(async (_request: RpcChatStartSessionRequest) => ({
		sessionId: `session_${++sessionCounter}`,
	}));
	const sendSession = vi.fn(
		async (_sessionId: string, _request: RpcChatRunTurnRequest) => {
			if (behavior.neverResolveSend) {
				return await new Promise<{ result: RpcChatTurnResult }>(() => {
					// Intentionally unresolved promise to force timeout path.
				});
			}
			if (behavior.sendResults && behavior.sendResults.length > 0) {
				const next = behavior.sendResults.shift();
				if (next) {
					return { result: next };
				}
			}
			return { result: successResult() };
		},
	);
	const abortSession = vi.fn(async (_sessionId: string) => ({ applied: true }));
	const stopSession = vi.fn(async (_sessionId: string) => ({ applied: true }));

	const service = new SchedulerService({
		sessionsDbPath: "/tmp/ignored-scheduler-service-test.db",
		pollIntervalMs: 10_000,
		runtimeHandlers: {
			startSession,
			sendSession,
			abortSession,
			stopSession,
		},
	});

	return {
		service,
		startSession,
		sendSession,
		abortSession,
		stopSession,
	};
}

beforeEach(() => {
	storeState.schedules.clear();
	storeState.executions.clear();
});

describe("SchedulerService", () => {
	it("supports routine lifecycle operations and records execution history", async () => {
		const harness = createHarness();
		const created = harness.service.createSchedule(baseScheduleInput);
		expect(created.scheduleId).toMatch(/^sched_/);
		expect(created.enabled).toBe(true);
		expect(created.nextRunAt).toBeTruthy();

		const listed = harness.service.listSchedules({ enabled: true, limit: 10 });
		expect(listed).toHaveLength(1);
		expect(listed[0]?.scheduleId).toBe(created.scheduleId);

		const paused = harness.service.pauseSchedule(created.scheduleId);
		expect(paused?.enabled).toBe(false);
		expect(paused?.nextRunAt).toBeUndefined();

		const resumed = harness.service.resumeSchedule(created.scheduleId);
		expect(resumed?.enabled).toBe(true);
		expect(resumed?.nextRunAt).toBeTruthy();

		const execution = await harness.service.triggerScheduleNow(
			created.scheduleId,
		);
		expect(execution?.status).toBe("success");
		expect(execution?.sessionId).toMatch(/^session_/);
		expect(execution?.iterations).toBe(2);
		expect(execution?.tokensUsed).toBe(10);
		expect(execution?.costUsd).toBe(0.42);
		expect(harness.stopSession).toHaveBeenCalledWith(execution?.sessionId);

		const history = harness.service.listScheduleExecutions({
			scheduleId: created.scheduleId,
			limit: 10,
		});
		expect(history).toHaveLength(1);
		expect(history[0]?.status).toBe("success");

		const stats = harness.service.getScheduleStats(created.scheduleId);
		expect(stats.totalRuns).toBe(1);
		expect(stats.successRate).toBe(1);
		expect(stats.lastFailure).toBeUndefined();

		expect(harness.service.getActiveExecutions()).toHaveLength(0);

		const deleted = harness.service.deleteSchedule(created.scheduleId);
		expect(deleted).toBe(true);
		expect(harness.service.getSchedule(created.scheduleId)).toBeUndefined();
	});

	it("returns undefined when triggering a missing schedule", async () => {
		const harness = createHarness();
		const execution = await harness.service.triggerScheduleNow("sched_missing");
		expect(execution).toBeUndefined();
		expect(harness.startSession).not.toHaveBeenCalled();
	});

	it("marks timed-out runs and aborts their runtime sessions", async () => {
		const harness = createHarness({ neverResolveSend: true });
		const created = harness.service.createSchedule({
			...baseScheduleInput,
			name: "Timeout routine",
			timeoutSeconds: 1,
		});
		const execution = await harness.service.triggerScheduleNow(
			created.scheduleId,
		);
		expect(execution?.status).toBe("timeout");
		expect(execution?.errorMessage).toContain("timed out");
		expect(harness.abortSession).toHaveBeenCalledWith(execution?.sessionId);
		expect(harness.stopSession).toHaveBeenCalledWith(execution?.sessionId);

		const history = harness.service.listScheduleExecutions({
			scheduleId: created.scheduleId,
			limit: 10,
		});
		expect(history[0]?.status).toBe("timeout");
	});

	it("supports autonomous routine polling and aggregates metrics across turns", async () => {
		const harness = createHarness({
			sendResults: [
				{
					text: "initial task complete",
					iterations: 2,
					inputTokens: 7,
					outputTokens: 3,
					usage: {
						inputTokens: 7,
						outputTokens: 3,
						totalCost: 0.42,
					},
					finishReason: "",
					messages: [],
					toolCalls: [],
				},
				{
					text: "Claimed task_0001 and finished follow-up work",
					iterations: 1,
					inputTokens: 2,
					outputTokens: 4,
					usage: {
						inputTokens: 2,
						outputTokens: 4,
						totalCost: 0.1,
					},
					finishReason: "",
					messages: [],
					toolCalls: [],
				},
				{
					text: "<idle-noop/>",
					iterations: 1,
					inputTokens: 1,
					outputTokens: 1,
					usage: {
						inputTokens: 1,
						outputTokens: 1,
						totalCost: 0.01,
					},
					finishReason: "",
					messages: [],
					toolCalls: [],
				},
			],
		});
		const created = harness.service.createSchedule({
			...baseScheduleInput,
			name: "Autonomous routine",
			metadata: {
				autonomous: {
					enabled: true,
					idleTimeoutSeconds: 2,
					pollIntervalSeconds: 1,
				},
			},
		});

		const execution = await harness.service.triggerScheduleNow(
			created.scheduleId,
		);

		expect(execution?.status).toBe("success");
		expect(execution?.iterations).toBe(4);
		expect(execution?.tokensUsed).toBe(18);
		expect(execution?.costUsd).toBe(0.53);
		expect(harness.sendSession).toHaveBeenCalledTimes(3);
		expect(harness.sendSession.mock.calls[1]?.[1].prompt).toContain(
			'team_task with action="list"',
		);
	});
});
