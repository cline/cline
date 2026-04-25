import { describe, expect, it, vi } from "vitest";
import { getNextCronTime, HubScheduler, ScheduleStore } from "./scheduler";

describe("hub scheduler cron helpers", () => {
	it("computes the next matching cron timestamp", () => {
		const after = new Date(2026, 3, 21, 10, 3, 12).getTime();
		const next = getNextCronTime("*/15 * * * *", after);
		expect(next).toBe(new Date(2026, 3, 21, 10, 15, 0).getTime());
	});

	it("computes the next matching cron timestamp in an explicit timezone", () => {
		const after = Date.parse("2026-04-21T15:30:00.000Z");
		const next = getNextCronTime("0 9 * * *", after, "America/New_York");
		expect(next).toBe(Date.parse("2026-04-22T13:00:00.000Z"));
	});
});

describe("ScheduleStore", () => {
	it("creates, updates, disables, and lists executions", () => {
		const store = new ScheduleStore();
		const now = new Date(2026, 3, 21, 10, 0, 0).getTime();

		const created = store.create(
			{
				name: "Morning check",
				cronPattern: "0 11 * * *",
				prompt: "Inspect inbox",
				workspaceRoot: "/workspace",
				runtimeOptions: { mode: "plan", maxIterations: 5 },
				metadata: { threadId: "thread-123" },
			},
			now,
		);

		expect(created.scheduleId).toMatch(/^sched_/);
		expect(created.nextRunAt).toBe(new Date(2026, 3, 21, 11, 0, 0).getTime());

		const updated = store.update(
			{
				scheduleId: created.scheduleId,
				cronPattern: "30 11 * * *",
				enabled: false,
			},
			now + 1_000,
		);
		expect(updated.enabled).toBe(false);
		expect(updated.nextRunAt).toBeUndefined();

		const reenabled = store.setEnabled(created.scheduleId, true, now + 2_000);
		expect(reenabled.nextRunAt).toBe(
			new Date(2026, 3, 21, 11, 30, 0).getTime(),
		);

		const execution = store.startExecution(
			created.scheduleId,
			"session-1",
			now,
		);
		const completed = store.completeExecution(
			execution.executionId,
			"completed",
			now + 10_000,
		);
		expect(store.listExecutions(created.scheduleId)).toEqual([completed]);
	});
});

describe("HubScheduler", () => {
	it("triggers schedules and records completion", async () => {
		const store = new ScheduleStore();
		const timestamps = [
			new Date(2026, 3, 21, 10, 0, 0).getTime(),
			new Date(2026, 3, 21, 10, 0, 1).getTime(),
			new Date(2026, 3, 21, 10, 0, 2).getTime(),
		];
		let index = 0;
		const now = () => timestamps[Math.min(index++, timestamps.length - 1)]!;

		const onTrigger = vi.fn(async () => ({ sessionId: "session-123" }));
		const onExecutionCompleted = vi.fn();
		const onExecutionFailed = vi.fn();
		const onScheduleUpdated = vi.fn();
		const onPersist = vi.fn(async () => {});

		const record = store.create(
			{
				name: "Run now",
				cronPattern: "5 10 * * *",
				prompt: "Do work",
				workspaceRoot: "/workspace",
			},
			timestamps[0]!,
		);

		const scheduler = new HubScheduler({
			store,
			now,
			callbacks: {
				onTrigger,
				onExecutionCompleted,
				onExecutionFailed,
				onScheduleUpdated,
				onPersist,
			},
		});

		const execution = await scheduler.triggerNow(record.scheduleId);
		expect(execution.status).toBe("running");
		expect(onTrigger).toHaveBeenCalledWith(expect.objectContaining(record));
		expect(onScheduleUpdated).toHaveBeenCalledTimes(1);

		await scheduler.notifySessionCompleted("session-123", false);

		expect(onExecutionCompleted).toHaveBeenCalledTimes(1);
		expect(onExecutionFailed).not.toHaveBeenCalled();
		expect(store.listExecutions(record.scheduleId)[0]?.status).toBe(
			"completed",
		);
		expect(onPersist).toHaveBeenCalledTimes(2);
	});

	it("records trigger failures as failed executions", async () => {
		const store = new ScheduleStore();
		const now = () => new Date(2026, 3, 21, 10, 0, 0).getTime();
		const onExecutionFailed = vi.fn();
		const onPersist = vi.fn(async () => {});

		const record = store.create(
			{
				name: "Broken run",
				cronPattern: "0 11 * * *",
				prompt: "Do work",
				workspaceRoot: "/workspace",
			},
			now(),
		);

		const scheduler = new HubScheduler({
			store,
			now,
			callbacks: {
				onTrigger: vi.fn(async () => {
					throw new Error("boom");
				}),
				onExecutionCompleted: vi.fn(),
				onExecutionFailed,
				onScheduleUpdated: vi.fn(),
				onPersist,
			},
		});

		const execution = await scheduler.triggerNow(record.scheduleId);
		expect(execution.status).toBe("failed");
		expect(execution.errorMessage).toBe("boom");
		expect(onExecutionFailed).toHaveBeenCalledTimes(1);
		expect(onPersist).toHaveBeenCalledTimes(1);
	});
});
