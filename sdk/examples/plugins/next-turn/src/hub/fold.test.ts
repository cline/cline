import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CURSOR_SAVE_EVERY_EVENTS, SEED_UPCOMING_LIMIT } from "../config";
import { useTempDirs } from "../test-support";
import { CursorWriter, readCursor } from "./cursor";
import { eventLog } from "./event-log.fixture";
import { ASK_QUESTION_CAPABILITY, emptyFold, foldEvent } from "./fold";
import { seedExecutions, seedSessions, seedTasks, seedUpcoming } from "./seed";

const ev = eventLog();

describe("runs and tools", () => {
	test("a run goes running → failed, and the workspace comes from the snapshot", () => {
		const fold = [
			ev("run.started", {}, "s1"),
			ev(
				"run.failed",
				{
					reason: "error",
					snapshot: { workspace: { root: "/repo", cwd: "/repo" } },
				},
				"s1",
			),
		].reduce(foldEvent, emptyFold());
		expect(fold.sessions.s1?.run).toBe("failed");
		expect(fold.sessions.s1?.workspaceRoot).toBe("/repo");
	});

	test("a hub restart reads as interrupted, not running forever", () => {
		const fold = [
			ev("run.started", {}, "s1"),
			ev("run.interrupted", { runId: "r", reason: "hub_restart" }, "s1"),
		].reduce(foldEvent, emptyFold());
		expect(fold.sessions.s1?.run).toBe("interrupted");
	});

	test("failed tool calls are deduped by id; hook-path copies without an id are ignored", () => {
		const fold = [
			ev("run.started", {}, "s1"),
			ev(
				"tool.finished",
				{
					toolCallId: "c1",
					toolName: "bash",
					error: "exit 1",
					output: "SECRET OUTPUT",
				},
				"s1",
			),
			ev(
				"tool.finished",
				{ toolCallId: "c1", toolName: "bash", error: "exit 1" },
				"s1",
			),
			ev("tool.finished", { toolName: "bash", error: "exit 1" }, "s1"),
			ev(
				"tool.finished",
				{ toolCallId: "c2", toolName: "read", output: "ok" },
				"s1",
			),
		].reduce(foldEvent, emptyFold());
		expect(fold.sessions.s1?.failedToolCalls).toEqual(["c1"]);
		expect(JSON.stringify(fold)).not.toContain("SECRET");
	});

	test("a new run clears the last run's tool failures", () => {
		const fold = [
			ev("tool.finished", { toolCallId: "c1", error: "x" }, "s1"),
			ev("run.started", {}, "s1"),
		].reduce(foldEvent, emptyFold());
		expect(fold.sessions.s1?.failedToolCalls).toEqual([]);
	});
});

describe("waiting on the person", () => {
	test("a finished run leaves no open question behind", () => {
		const fold = [
			ev("run.started", {}, "s1"),
			ev(
				"capability.requested",
				{ requestId: "q1", capabilityName: ASK_QUESTION_CAPABILITY },
				"s1",
			),
			ev("run.aborted", {}, "s1"),
		].reduce(foldEvent, emptyFold());
		expect(fold.sessions.s1?.pendingQuestions).toEqual({});
	});

	test("an approval is pending until resolved; the resolution carries only its id", () => {
		const requested = [
			ev("approval.requested", {
				approvalId: "a1",
				sessionId: "s1",
				toolName: "bash",
				inputJson: '{"cmd":"rm"}',
			}),
		].reduce(foldEvent, emptyFold());
		expect(requested.sessions.s1?.pendingApprovals.a1?.toolName).toBe("bash");
		expect(JSON.stringify(requested)).not.toContain("rm");
		const resolved = foldEvent(
			requested,
			ev("approval.resolved", { approvalId: "a1", approved: true }),
		);
		expect(resolved.sessions.s1?.pendingApprovals).toEqual({});
	});

	test("a resolution that names its session resolves there", () => {
		const requested = [
			ev("approval.requested", { approvalId: "a1", sessionId: "s1" }),
			ev(
				"capability.requested",
				{ requestId: "q1", capabilityName: ASK_QUESTION_CAPABILITY },
				"s2",
			),
		].reduce(foldEvent, emptyFold());
		const resolved = [
			ev("approval.resolved", { approvalId: "a1" }, "s1"),
			ev(
				"capability.resolved",
				{ requestId: "q1", capabilityName: ASK_QUESTION_CAPABILITY },
				"s2",
			),
		].reduce(foldEvent, requested);
		expect(resolved.sessions.s1?.pendingApprovals).toEqual({});
		expect(resolved.sessions.s2?.pendingQuestions).toEqual({});
	});

	test("re-issued pending approvals without a sequence fold idempotently", () => {
		const once = foldEvent(
			emptyFold(),
			ev("approval.requested", { approvalId: "a1", sessionId: "s1" }),
		);
		const again = foldEvent(once, {
			event: "approval.requested",
			payload: { approvalId: "a1", sessionId: "s1" },
		});
		expect(Object.keys(again.sessions.s1?.pendingApprovals ?? {})).toEqual([
			"a1",
		]);
	});

	test("only ask-question capability requests count as open questions", () => {
		const fold = [
			ev(
				"capability.requested",
				{
					requestId: "q1",
					capabilityName: ASK_QUESTION_CAPABILITY,
					payload: { args: ["Which?"] },
				},
				"s1",
			),
			ev(
				"capability.requested",
				{ requestId: "x1", capabilityName: "checkpoint.create" },
				"s1",
			),
		].reduce(foldEvent, emptyFold());
		expect(Object.keys(fold.sessions.s1?.pendingQuestions ?? {})).toEqual([
			"q1",
		]);
		expect(JSON.stringify(fold)).not.toContain("Which?");
		const answered = foldEvent(
			fold,
			ev("capability.resolved", {
				requestId: "q1",
				capabilityName: ASK_QUESTION_CAPABILITY,
				ok: true,
			}),
		);
		expect(answered.sessions.s1?.pendingQuestions).toEqual({});
	});
});

describe("tasks, schedules, teams, usage, sessions", () => {
	test("task events keep the record's facts and drop its instructions", () => {
		const fold = [
			ev("task.created", {
				task: {
					taskId: "t1",
					status: "pending_approval",
					title: "Return 405",
					priority: 2,
					revision: 1,
					instructions: "PRIVATE PLAN",
				},
			}),
			ev("task.updated", {
				task: {
					taskId: "t1",
					status: "approved",
					title: "Return 405",
					priority: 2,
					revision: 2,
				},
			}),
		].reduce(foldEvent, emptyFold());
		expect(fold.tasks.t1).toMatchObject({
			status: "approved",
			title: "Return 405",
			priority: 2,
		});
		expect(JSON.stringify(fold)).not.toContain("PRIVATE");
		expect(
			foldEvent(fold, ev("task.deleted", { task: { taskId: "t1" } })).tasks,
		).toEqual({});
	});

	test("task.run.started, task.run.completed and task.run.failed move task rows out of approved", () => {
		const started = [
			ev("task.created", {
				task: {
					taskId: "t1",
					status: "approved",
					title: "Ship auth",
					priority: 1,
					revision: 1,
				},
			}),
			ev("task.run.started", {
				task: {
					taskId: "t1",
					status: "in_progress",
					title: "Ship auth",
					priority: 1,
					revision: 2,
					lastSessionId: "s_run",
				},
				run: {
					runId: "r1",
					taskId: "t1",
					status: "running",
					sessionId: "s_run",
				},
			}),
		].reduce(foldEvent, emptyFold());
		expect(started.tasks.t1?.status).toBe("in_progress");

		const completed = foldEvent(
			started,
			ev("task.run.completed", {
				task: {
					taskId: "t1",
					status: "completed",
					title: "Ship auth",
					priority: 1,
					revision: 3,
					lastSessionId: "s_run",
				},
				run: {
					runId: "r1",
					taskId: "t1",
					status: "completed",
					sessionId: "s_run",
				},
			}),
		);
		expect(completed.tasks.t1?.status).toBe("completed");

		const failed = foldEvent(
			started,
			ev("task.run.failed", {
				task: {
					taskId: "t1",
					status: "failed",
					title: "Ship auth",
					priority: 1,
					revision: 3,
					lastSessionId: "s_run",
				},
				run: {
					runId: "r1",
					taskId: "t1",
					status: "failed",
					sessionId: "s_run",
				},
			}),
		);
		expect(failed.tasks.t1?.status).toBe("failed");
	});

	test("a failed scheduled run is kept with its session, and schedule.deleted removes it", () => {
		const fold = foldEvent(
			emptyFold(),
			ev("schedule.execution_failed", {
				scheduleId: "nightly",
				executionId: "e1",
				sessionId: "s9",
				status: "failed",
				errorMessage: "boom",
			}),
		);
		expect(fold.schedules.nightly).toEqual({
			scheduleId: "nightly",
			status: "failed",
			executionId: "e1",
			sessionId: "s9",
			endedAt: undefined,
		});
		expect(
			foldEvent(fold, ev("schedule.deleted", { scheduleId: "nightly" }))
				.schedules,
		).toEqual({});
	});

	test("disabling a schedule clears its next run; other updates keep it", () => {
		const named = seedUpcoming(emptyFold(), {
			runs: [
				{
					scheduleId: "nightly",
					name: "Nightly checks",
					nextRunAt: "2026-10-09T02:00:00.000Z",
				},
			],
		});
		const edited = foldEvent(
			named,
			ev("schedule.updated", {
				schedule: { scheduleId: "nightly", enabled: true, prompt: "PRIVATE" },
			}),
		);
		expect(edited.schedules).toEqual(named.schedules);
		const disabled = foldEvent(
			edited,
			ev("schedule.updated", {
				schedule: { scheduleId: "nightly", enabled: false },
			}),
		);
		expect(disabled.schedules.nightly).toEqual({
			scheduleId: "nightly",
			name: "Nightly checks",
		});
		expect(JSON.stringify(disabled)).not.toContain("PRIVATE");
	});

	test("session records supply the workspace from session or snapshot, parse ISO updatedAt, and drop prompt/metadata", () => {
		const fold = [
			ev("session.created", {
				session: {
					sessionId: "s2",
					workspaceRoot: "/w",
					updatedAt: 7,
					prompt: "SECRET",
					metadata: { secret: "1" },
				},
			}),
			ev("session.updated", {
				sessionId: "s3",
				snapshot: {
					workspaceRoot: "/w3",
					updatedAt: "2026-10-08T12:00:00.000Z",
					prompt: "SECRET2",
				},
			}),
		].reduce(foldEvent, emptyFold());
		expect(fold.sessions.s2).toMatchObject({
			workspaceRoot: "/w",
			updatedAt: 7,
			run: "idle",
		});
		expect(fold.sessions.s3).toMatchObject({
			workspaceRoot: "/w3",
			updatedAt: Date.parse("2026-10-08T12:00:00.000Z"),
			run: "idle",
		});
		expect(JSON.stringify(fold)).not.toContain("SECRET");
	});
});

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

describe("replay safety", () => {
	test("events outside the allowlist and already-folded sequences change nothing", () => {
		const start = foldEvent(emptyFold(), {
			event: "run.started",
			sequence: 10,
			sessionId: "s1",
		});
		expect(
			foldEvent(start, {
				event: "assistant.delta",
				sequence: 11,
				sessionId: "s1",
				payload: { text: "hi" },
			}),
		).toBe(start);
		expect(
			foldEvent(start, {
				event: "run.completed",
				sequence: 9,
				sessionId: "s1",
			}),
		).toBe(start);
		expect(start.sequence).toBe(10);
	});

	test("replaying a log over a live fold gives the same fold", () => {
		const log = [
			ev("run.started", {}, "s1"),
			ev("approval.requested", { approvalId: "a", sessionId: "s1" }),
			ev("run.completed", {}, "s1"),
		];
		const live = log.reduce(foldEvent, emptyFold());
		expect(log.reduce(foldEvent, live)).toEqual(live);
	});
});

describe("cursor", () => {
	const tempDir = useTempDirs("next-turn-cursor-");
	const path = () => join(tempDir(), "cursor.json");

	test("writes every N advances and on flush, never moving backwards", () => {
		const file = path();
		const writer = new CursorWriter(file, 0, () => 123);
		for (let i = 1; i < CURSOR_SAVE_EVERY_EVENTS; i += 1) writer.advance(i);
		expect(readCursor(file)).toBeUndefined();
		writer.advance(CURSOR_SAVE_EVERY_EVENTS);
		expect(readCursor(file)).toEqual({
			sequence: CURSOR_SAVE_EVERY_EVENTS,
			savedAt: 123,
		});
		writer.advance(3);
		writer.advance(CURSOR_SAVE_EVERY_EVENTS + 1);
		writer.flush();
		expect(readCursor(file)?.sequence).toBe(CURSOR_SAVE_EVERY_EVENTS + 1);
	});

	test("a write that keeps failing leaves no temp files and waits another N advances to retry", () => {
		const file = path();
		mkdirSync(file);
		const writer = new CursorWriter(file);
		for (let i = 1; i <= CURSOR_SAVE_EVERY_EVENTS + 1; i += 1)
			writer.advance(i);
		expect(readdirSync(dirname(file))).toEqual(["cursor.json"]);
		expect(writer.current()).toBe(CURSOR_SAVE_EVERY_EVENTS + 1);
	});

	test("a missing or malformed cursor starts from zero", () => {
		const file = path();
		expect(new CursorWriter(file).current()).toBe(0);
		writeFileSync(file, JSON.stringify({ sequence: -4 }));
		expect(readCursor(file)).toBeUndefined();
	});
});
