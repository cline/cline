import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CURSOR_SAVE_EVERY_EVENTS } from "../config";
import { CursorWriter, readCursor } from "./cursor";
import {
	ASK_QUESTION_CAPABILITY,
	emptyFold,
	foldEvent,
	foldEvents,
} from "./fold";
import type { HubEvent } from "./link";

let seq = 0;
function ev(
	event: string,
	payload: Record<string, unknown> = {},
	sessionId?: string,
): HubEvent {
	seq += 1;
	return { event, sequence: seq, sessionId, timestamp: seq * 1000, payload };
}

describe("runs and tools", () => {
	test("a run goes running → failed, and the workspace comes from the snapshot", () => {
		const fold = foldEvents(emptyFold(), [
			ev("run.started", {}, "s1"),
			ev(
				"run.failed",
				{
					reason: "error",
					snapshot: { workspace: { root: "/repo", cwd: "/repo" } },
				},
				"s1",
			),
		]);
		expect(fold.sessions.s1?.run).toBe("failed");
		expect(fold.sessions.s1?.workspaceRoot).toBe("/repo");
	});

	test("a hub restart reads as interrupted, not running forever", () => {
		const fold = foldEvents(emptyFold(), [
			ev("run.started", {}, "s1"),
			ev("run.interrupted", { runId: "r", reason: "hub_restart" }, "s1"),
		]);
		expect(fold.sessions.s1?.run).toBe("interrupted");
	});

	test("failed tool calls are deduped by id; hook-path copies without an id are ignored", () => {
		const fold = foldEvents(emptyFold(), [
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
		]);
		expect(fold.sessions.s1?.failedToolCalls).toEqual(["c1"]);
		expect(JSON.stringify(fold)).not.toContain("SECRET");
	});

	test("a new run clears the last run's tool failures", () => {
		const fold = foldEvents(emptyFold(), [
			ev("tool.finished", { toolCallId: "c1", error: "x" }, "s1"),
			ev("run.started", {}, "s1"),
		]);
		expect(fold.sessions.s1?.failedToolCalls).toEqual([]);
	});
});

describe("waiting on the person", () => {
	test("an approval is pending until resolved; the resolution carries only its id", () => {
		const requested = foldEvents(emptyFold(), [
			ev("approval.requested", {
				approvalId: "a1",
				sessionId: "s1",
				toolName: "bash",
				inputJson: '{"cmd":"rm"}',
			}),
		]);
		expect(requested.sessions.s1?.pendingApprovals.a1?.toolName).toBe("bash");
		expect(JSON.stringify(requested)).not.toContain("rm");
		const resolved = foldEvent(
			requested,
			ev("approval.resolved", { approvalId: "a1", approved: true }),
		);
		expect(resolved.sessions.s1?.pendingApprovals).toEqual({});
		expect(resolved.pendingIndex).toEqual({});
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
		const fold = foldEvents(emptyFold(), [
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
		]);
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
		const fold = foldEvents(emptyFold(), [
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
		]);
		expect(fold.tasks.t1).toMatchObject({
			status: "approved",
			revision: 2,
			priority: 2,
		});
		expect(JSON.stringify(fold)).not.toContain("PRIVATE");
		expect(
			foldEvent(fold, ev("task.deleted", { task: { taskId: "t1" } })).tasks,
		).toEqual({});
	});

	test("task.run.started, task.run.completed and task.run.failed move task rows out of approved", () => {
		const started = foldEvents(emptyFold(), [
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
		]);
		expect(started.tasks.t1).toMatchObject({
			status: "in_progress",
			revision: 2,
			lastSessionId: "s_run",
		});

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
		expect(completed.tasks.t1).toMatchObject({
			status: "completed",
			revision: 3,
		});

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
		expect(failed.tasks.t1).toMatchObject({ status: "failed", revision: 3 });
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

	test("session records supply the workspace from session or snapshot, parse ISO updatedAt, and drop prompt/metadata", () => {
		const fold = foldEvents(emptyFold(), [
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
		]);
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
		const live = foldEvents(emptyFold(), log);
		expect(foldEvents(live, log)).toEqual(live);
	});
});

describe("cursor", () => {
	const temps: string[] = [];
	afterEach(() => {
		for (const dir of temps.splice(0))
			rmSync(dir, { recursive: true, force: true });
	});
	function path(): string {
		const dir = mkdtempSync(join(tmpdir(), "next-turn-cursor-"));
		temps.push(dir);
		return join(dir, "cursor.json");
	}

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

	test("a missing or malformed cursor starts from zero", () => {
		const file = path();
		expect(new CursorWriter(file).current()).toBe(0);
		writeFileSync(file, JSON.stringify({ sequence: -4 }));
		expect(readCursor(file)).toBeUndefined();
	});
});
