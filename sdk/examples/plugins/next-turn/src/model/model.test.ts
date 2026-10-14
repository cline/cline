import { describe, expect, test } from "bun:test";
import { emptyFold, foldEvents } from "../hub/fold";
import type { HubEvent } from "../hub/link";
import { seedSessions, seedTasks } from "../hub/seed";
import { needsYou, newItems } from "./needs-you";
import {
	type ExplicitStatus,
	sessionRowFor,
	statusBoard,
} from "./session-rows";

let seq = 0;
function ev(
	event: string,
	payload: Record<string, unknown> = {},
	sessionId?: string,
	timestamp?: number,
): HubEvent {
	seq += 1;
	return {
		event,
		sequence: seq,
		sessionId,
		timestamp: timestamp ?? seq * 1000,
		payload,
	};
}

function report(
	overrides: Partial<ExplicitStatus> & Pick<ExplicitStatus, "updateId">,
): ExplicitStatus {
	return {
		subject: `work/${overrides.updateId}`,
		state: "running",
		headline: "Migrating the router",
		priority: "normal",
		createdAt: "2026-10-08T10:00:00.000Z",
		supersededAt: null,
		...overrides,
	};
}

describe("implicit status: session rows", () => {
	test("each run state maps to its row, and idle sessions get none", () => {
		const fold = foldEvents(emptyFold(), [
			ev("run.started", {}, "running"),
			ev("run.started", {}, "done"),
			ev("run.completed", {}, "done"),
			ev("run.started", {}, "failed"),
			ev("run.failed", {}, "failed"),
			ev("run.started", {}, "stopped"),
			ev("run.aborted", {}, "stopped"),
			ev("session.created", {
				session: { sessionId: "idle", workspaceRoot: "/w" },
			}),
		]);
		const states = Object.fromEntries(
			statusBoard(fold).sessions.map((row) => [row.sessionId, row.state]),
		);
		expect(states).toEqual({
			running: "running",
			done: "done",
			failed: "failed",
			stopped: "stopped",
		});
	});

	test("a pending approval or question makes the session waiting, ahead of everything else", () => {
		const fold = foldEvents(emptyFold(), [
			ev("run.started", {}, "a"),
			ev("run.failed", {}, "a"),
			ev("run.started", {}, "b"),
			ev("approval.requested", {
				approvalId: "ap",
				sessionId: "b",
				toolName: "bash",
			}),
		]);
		const rows = statusBoard(fold).sessions;
		expect(rows.map((row) => [row.sessionId, row.state])).toEqual([
			["b", "waiting"],
			["a", "failed"],
		]);
		expect(rows[0]?.approvals).toBe(1);
	});

	test("a hub restart reads as interrupted, not running forever", () => {
		const fold = foldEvents(emptyFold(), [
			ev("run.started", {}, "s"),
			ev("run.interrupted", { reason: "hub_restart" }, "s"),
		]);
		expect(statusBoard(fold).sessions[0]?.state).toBe("interrupted");
	});

	test("explicit rows nest under their session; others stand alone; superseded rows drop", () => {
		const fold = foldEvents(emptyFold(), [ev("run.started", {}, "s1")]);
		const board = statusBoard(fold, [
			report({ updateId: "u1", sessionId: "s1" }),
			report({ updateId: "u2", sessionId: "s-gone" }),
			report({ updateId: "u3" }),
			report({
				updateId: "u4",
				sessionId: "s1",
				supersededAt: "2026-10-08T10:05:00.000Z",
			}),
		]);
		expect(
			sessionRowFor(board, "s1")?.reports.map((row) => row.updateId),
		).toEqual(["u1"]);
		expect(board.reports.map((row) => row.updateId)).toEqual(["u2", "u3"]);
	});

	test("a workspace scope keeps that workspace and anything unscoped", () => {
		const fold = foldEvents(emptyFold(), [
			ev("session.created", {
				session: { sessionId: "here", workspaceRoot: "/here" },
			}),
			ev("session.created", {
				session: { sessionId: "there", workspaceRoot: "/there" },
			}),
			ev("run.started", {}, "here"),
			ev("run.started", {}, "there"),
		]);
		const board = statusBoard(
			fold,
			[
				report({ updateId: "x", workspaceRoot: "/there" }),
				report({ updateId: "y" }),
			],
			{ workspaceRoot: "/here" },
		);
		expect(board.sessions.map((row) => row.sessionId)).toEqual(["here"]);
		expect(board.reports.map((row) => row.updateId)).toEqual(["y"]);
	});
});

describe("Needs you", () => {
	test("ranks approvals and questions first, then urgent tasks, oldest waiting first", () => {
		const fold = foldEvents(emptyFold(), [
			ev(
				"task.created",
				{
					task: {
						taskId: "t-low",
						status: "pending_approval",
						title: "Tidy",
						priority: 3,
					},
				},
				undefined,
				100,
			),
			ev(
				"task.created",
				{
					task: {
						taskId: "t-p0",
						status: "pending_approval",
						title: "Hotfix",
						priority: 0,
					},
				},
				undefined,
				200,
			),
			ev(
				"task.created",
				{
					task: {
						taskId: "t-done",
						status: "approved",
						title: "Done",
						priority: 0,
					},
				},
				undefined,
				50,
			),
			ev(
				"approval.requested",
				{ approvalId: "ap", sessionId: "s1", toolName: "bash" },
				undefined,
				500,
			),
			ev(
				"capability.requested",
				{ requestId: "q", capabilityName: "tool_executor.askQuestion" },
				"s2",
				400,
			),
		]);
		const items = needsYou(fold, [
			report({
				updateId: "blocked",
				state: "blocked",
				sessionId: "s3",
				createdAt: "2026-10-08T09:00:00.000Z",
			}),
			report({ updateId: "calm" }),
		]);
		expect(items.map((item) => item.key)).toEqual([
			"question:q",
			"approval:ap",
			"task:t-p0",
			"status:blocked",
			"task:t-low",
		]);
	});

	test("every item opens where it is answered", () => {
		const fold = foldEvents(emptyFold(), [
			ev("approval.requested", { approvalId: "ap", sessionId: "s1" }),
			ev("task.created", {
				task: { taskId: "t", status: "pending_approval", title: "T" },
			}),
		]);
		const opens = Object.fromEntries(
			needsYou(fold, [report({ updateId: "c", priority: "critical" })]).map(
				(item) => [item.key, item.opens],
			),
		);
		expect(opens).toEqual({
			"approval:ap": { kind: "chat", sessionId: "s1" },
			"task:t": { kind: "task", taskId: "t" },
			"status:c": { kind: "status", subject: "work/c" },
		});
	});

	test("a resolved approval leaves the list, and only new keys count as new", () => {
		const waiting = foldEvents(emptyFold(), [
			ev("approval.requested", { approvalId: "a", sessionId: "s" }),
			ev("approval.requested", { approvalId: "b", sessionId: "s" }),
		]);
		const before = needsYou(waiting);
		const after = needsYou(
			foldEvents(waiting, [
				ev("approval.resolved", { approvalId: "a" }),
				ev("approval.requested", { approvalId: "c", sessionId: "s" }),
			]),
		);
		expect(after.map((item) => item.key)).toEqual(["approval:b", "approval:c"]);
		expect(newItems(before, after).map((item) => item.key)).toEqual([
			"approval:c",
		]);
	});
});

describe("cold-start seed", () => {
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
		const live = foldEvents(emptyFold(), [
			ev("run.started", {}, "s1"),
			ev("run.completed", {}, "s1"),
		]);
		const seeded = seedSessions(live, {
			sessions: [{ sessionId: "s1", status: "running" }],
		});
		expect(seeded.sessions.s1?.run).toBe("completed");
		expect(seedTasks(live, { tasks: "not a list" })).toBe(live);
	});
});
