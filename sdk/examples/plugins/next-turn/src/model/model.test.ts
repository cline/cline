import { describe, expect, test } from "bun:test";
import { eventLog } from "../hub/event-log.fixture";
import { emptyFold, foldEvent } from "../hub/fold";
import { needsYou, newItems } from "./needs-you";
import {
	type ExplicitStatus,
	sessionRowFor,
	statusBoard,
} from "./session-rows";

const ev = eventLog();

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
		const fold = [
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
		].reduce(foldEvent, emptyFold());
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
		const fold = [
			ev("run.started", {}, "a"),
			ev("run.failed", {}, "a"),
			ev("run.started", {}, "b"),
			ev("approval.requested", {
				approvalId: "ap",
				sessionId: "b",
				toolName: "bash",
			}),
		].reduce(foldEvent, emptyFold());
		const rows = statusBoard(fold).sessions;
		expect(rows.map((row) => [row.sessionId, row.state])).toEqual([
			["b", "waiting"],
			["a", "failed"],
		]);
		expect(rows[0]?.approvals).toBe(1);
	});

	test("a hub restart reads as interrupted, not running forever", () => {
		const fold = [
			ev("run.started", {}, "s"),
			ev("run.interrupted", { reason: "hub_restart" }, "s"),
		].reduce(foldEvent, emptyFold());
		expect(statusBoard(fold).sessions[0]?.state).toBe("interrupted");
	});

	test("explicit rows nest under their session; others stand alone; superseded rows drop", () => {
		const fold = [ev("run.started", {}, "s1")].reduce(foldEvent, emptyFold());
		const board = statusBoard(fold, [
			report({ updateId: "u1", sessionId: "s1" }),
			report({ updateId: "u2", sessionId: "s-gone" }),
			report({ updateId: "u3" }),
			report({
				updateId: "u4",
				sessionId: "s1",
				supersededAt: "2026-10-08T10:05:00.000Z",
			}),
			report({ updateId: "u5", sessionId: "s1", supersededAt: "" }),
		]);
		expect(
			sessionRowFor(board, "s1")?.reports.map((row) => row.updateId),
		).toEqual(["u1", "u5"]);
		expect(board.reports.map((row) => row.updateId)).toEqual(["u2", "u3"]);
	});

	test("a workspace scope keeps that workspace and anything unscoped", () => {
		const fold = [
			ev("session.created", {
				session: { sessionId: "here", workspaceRoot: "/here" },
			}),
			ev("session.created", {
				session: { sessionId: "there", workspaceRoot: "/there" },
			}),
			ev("run.started", {}, "here"),
			ev("run.started", {}, "there"),
		].reduce(foldEvent, emptyFold());
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
		const fold = [
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
		].reduce(foldEvent, emptyFold());
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
		const fold = [
			ev("approval.requested", { approvalId: "ap", sessionId: "s1" }),
			ev("task.created", {
				task: { taskId: "t", status: "pending_approval", title: "T" },
			}),
		].reduce(foldEvent, emptyFold());
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
		const waiting = [
			ev("approval.requested", { approvalId: "a", sessionId: "s" }),
			ev("approval.requested", { approvalId: "b", sessionId: "s" }),
		].reduce(foldEvent, emptyFold());
		const before = needsYou(waiting);
		const after = needsYou(
			[
				ev("approval.resolved", { approvalId: "a" }),
				ev("approval.requested", { approvalId: "c", sessionId: "s" }),
			].reduce(foldEvent, waiting),
		);
		expect(after.map((item) => item.key)).toEqual(["approval:b", "approval:c"]);
		expect(newItems(before, after).map((item) => item.key)).toEqual([
			"approval:c",
		]);
	});
});
