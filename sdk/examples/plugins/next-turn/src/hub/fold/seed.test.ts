import { describe, expect, test } from "bun:test";
import { SEED_UPCOMING_LIMIT } from "../../config";
import { eventLog } from "../event-log.fixtures";
import { foldEvent } from "./fold";
import { seedExecutions, seedSessions, seedTasks, seedUpcoming } from "./seed";
import { emptyFold } from "./state";

const ev = eventLog();

describe("seed", () => {
	test("fills sessions and tasks from command replies, without instructions", () => {
		const fold = seedTasks(
			seedSessions(emptyFold(), {
				sessions: [
					{
						sessionId: "s1",
						workspaceRoot: "/w",
						status: "running",
						updatedAt: 9,
						aggregateUsage: { totalCost: 1.5 },
					},
					{ sessionId: "s2", workspaceRoot: "/w", status: "pending" },
					{ status: "running" },
				],
			}),
			{
				tasks: [
					{
						taskId: "t1",
						status: "pending_approval",
						title: "Ship",
						priority: 1,
						instructions: "PRIVATE",
						updatedAt: "2026-10-08T10:00:00.000Z",
					},
				],
			},
		);
		expect(fold.sessions.s1).toMatchObject({
			run: "running",
			workspaceRoot: "/w",
			updatedAt: 9,
			totalCost: 1.5,
		});
		expect(fold.sessions.s2?.run).toBe("idle");
		expect(Object.keys(fold.sessions)).toEqual(["s1", "s2"]);
		expect(fold.tasks.t1).toMatchObject({
			status: "pending_approval",
			priority: 1,
			updatedAt: Date.parse("2026-10-08T10:00:00.000Z"),
		});
		expect(JSON.stringify(fold)).not.toContain("PRIVATE");
	});

	test("never overwrites what live events already folded", () => {
		const live = [
			ev("run.started", {}, "s1"),
			ev("run.completed", {}, "s1"),
		].reduce(foldEvent, emptyFold());
		const seeded = seedSessions(live, {
			sessions: [{ sessionId: "s1", status: "running" }],
		});
		expect(seeded.sessions.s1?.run).toBe("completed");
		expect(seedTasks(live, { tasks: "not a list" })).toBe(live);
	});

	test("upcoming runs refresh their name and next run on every seed", () => {
		const once = seedUpcoming(emptyFold(), {
			runs: [
				{
					scheduleId: "soon",
					name: "Nightly checks",
					nextRunAt: "2026-10-09T02:00:00.000Z",
				},
			],
		});
		const moved = seedUpcoming(once, {
			runs: [
				{
					scheduleId: "soon",
					name: "Nightly checks",
					nextRunAt: "2026-10-10T02:00:00.000Z",
				},
			],
		});
		expect(moved.schedules.soon?.nextRunAt).toBe("2026-10-10T02:00:00.000Z");
	});

	test("a schedule an upcoming reply leaves out keeps its next run until that time has passed", () => {
		const hour = 3_600_000;
		const passed = new Date(Date.now() - hour).toISOString();
		const ahead = new Date(Date.now() + hour).toISOString();
		const seeded = seedUpcoming(emptyFold(), {
			runs: [
				{ scheduleId: "done", nextRunAt: passed },
				{ scheduleId: "capped", nextRunAt: ahead },
			],
		});
		const short = seedUpcoming(seeded, { runs: [] });
		expect(short.schedules.done).toEqual({ scheduleId: "done" });
		expect(short.schedules.capped?.nextRunAt).toBe(ahead);
	});

	test("a complete enabled list clears a left-out schedule's future run; a full or malformed one proves nothing", () => {
		const ahead = new Date(Date.now() + 3_600_000).toISOString();
		const seeded = seedUpcoming(emptyFold(), {
			runs: [
				{ scheduleId: "capped", nextRunAt: ahead },
				{ scheduleId: "gone", nextRunAt: ahead },
			],
		});
		const cleared = seedUpcoming(
			seeded,
			{ runs: [] },
			{ schedules: [{ scheduleId: "capped", prompt: "PRIVATE" }] },
		);
		expect(cleared.schedules.capped?.nextRunAt).toBe(ahead);
		expect(cleared.schedules.gone).toEqual({ scheduleId: "gone" });
		expect(JSON.stringify(cleared)).not.toContain("PRIVATE");
		const full = {
			schedules: Array.from({ length: SEED_UPCOMING_LIMIT }, (_, index) => ({
				scheduleId: `other-${index}`,
			})),
		};
		expect(seedUpcoming(seeded, { runs: [] }, full)).toBe(seeded);
		expect(seedUpcoming(seeded, { runs: [] }, { schedules: "none" })).toBe(
			seeded,
		);
	});

	test("keeps each schedule's latest execution, and live events win", () => {
		const seeded = seedExecutions(emptyFold(), {
			executions: [
				{
					executionId: "e1",
					scheduleId: "nightly",
					status: "failed",
					triggeredAt: 1,
					endedAt: 2,
					errorMessage: "SECRET",
				},
				{
					executionId: "e2",
					scheduleId: "nightly",
					status: "success",
					triggeredAt: 3,
					endedAt: 4,
				},
				{
					executionId: "e3",
					scheduleId: "weekly",
					status: "timeout",
					triggeredAt: 5,
					endedAt: 6,
					sessionId: "s3",
				},
			],
		});
		expect(seeded.schedules.nightly).toMatchObject({
			executionId: "e2",
			status: "success",
		});
		expect(seeded.schedules.weekly).toMatchObject({
			executionId: "e3",
			status: "timeout",
			sessionId: "s3",
		});
		expect(JSON.stringify(seeded)).not.toContain("SECRET");
		const live = foldEvent(
			emptyFold(),
			ev("schedule.execution_failed", {
				scheduleId: "nightly",
				executionId: "e9",
				status: "failed",
			}),
		);
		expect(
			seedExecutions(live, {
				executions: [
					{
						executionId: "e2",
						scheduleId: "nightly",
						status: "success",
						endedAt: 4,
					},
				],
			}).schedules.nightly?.executionId,
		).toBe("e9");
	});

	test("a live execution keeps the schedule's name and next run", () => {
		const named = seedUpcoming(emptyFold(), {
			runs: [
				{
					scheduleId: "nightly",
					name: "Nightly checks",
					nextRunAt: "2026-10-09T02:00:00.000Z",
				},
			],
		});
		const failed = foldEvent(
			named,
			ev("schedule.execution_failed", {
				scheduleId: "nightly",
				executionId: "e1",
				sessionId: "s1",
			}),
		);
		expect(failed.schedules.nightly).toMatchObject({
			name: "Nightly checks",
			status: "failed",
			sessionId: "s1",
		});
	});
});
