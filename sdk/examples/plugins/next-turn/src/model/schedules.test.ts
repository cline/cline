import { describe, expect, test } from "bun:test";
import { eventLog } from "../hub/event-log.fixture";
import { emptyFold, foldEvent } from "../hub/fold";
import { seedUpcoming } from "../hub/seed";
import { needsYou } from "./needs-you";
import { teamSummary, upcomingRuns } from "./schedules";
import { statusBoard } from "./session-rows";

const ev = eventLog();

describe("schedules", () => {
	test("upcoming runs come soonest first with their names", () => {
		const fold = seedUpcoming(emptyFold(), {
			runs: [
				{
					scheduleId: "late",
					name: "Weekly audit",
					nextRunAt: "2026-10-12T09:00:00.000Z",
				},
				{
					scheduleId: "soon",
					name: "Nightly checks",
					nextRunAt: "2026-10-09T02:00:00.000Z",
				},
			],
		});
		expect(upcomingRuns(fold).map((run) => run.name)).toEqual([
			"Nightly checks",
			"Weekly audit",
		]);
	});

	test("a failed run attaches to its session's row, or stands alone, and needs the person", () => {
		const fold = [
			ev("run.started", {}, "s1"),
			ev("run.failed", {}, "s1"),
			ev("schedule.execution_failed", {
				scheduleId: "nightly",
				executionId: "e1",
				sessionId: "s1",
				status: "failed",
			}),
			ev("schedule.execution_failed", {
				scheduleId: "orphan",
				executionId: "e2",
				status: "timeout",
			}),
			ev("schedule.execution_completed", {
				scheduleId: "fine",
				executionId: "e3",
				status: "success",
			}),
		].reduce(
			foldEvent,
			seedUpcoming(emptyFold(), {
				runs: [
					{ scheduleId: "nightly", name: "Nightly checks", nextRunAt: "x" },
				],
			}),
		);
		const board = statusBoard(fold);
		expect(board.sessions[0]?.schedule).toEqual({
			scheduleId: "nightly",
			name: "Nightly checks",
		});
		expect(board.schedules.map((row) => row.scheduleId)).toEqual(["orphan"]);
		const items = needsYou(fold).filter((item) => item.kind === "schedule");
		expect(items.map((item) => [item.key, item.opens])).toEqual([
			["schedule:nightly:e1", { kind: "chat", sessionId: "s1" }],
			["schedule:orphan:e2", { kind: "schedule", scheduleId: "orphan" }],
		]);
	});
});

describe("teams", () => {
	test("blocked if any task is blocked, otherwise running until complete", () => {
		const base = {
			sessionId: "lead",
			teamName: "router",
			blockedTasks: 0,
			readyTasks: 2,
		};
		expect(
			teamSummary({ ...base, blockedTasks: 1, completionPct: 100 }).state,
		).toBe("blocked");
		expect(teamSummary({ ...base, completionPct: 40 }).state).toBe("running");
		expect(teamSummary({ ...base, completionPct: 100 })).toMatchObject({
			state: "done",
			subject: "team:router",
		});
	});

	test("a team attaches to its lead's row, or stands alone", () => {
		const progress = (sessionId: string, teamName: string) =>
			ev("team.progress", {
				sessionId,
				summary: {
					teamName,
					tasks: { blockedTaskIds: ["x"], readyTaskIds: [], completionPct: 10 },
				},
			});
		const fold = [
			ev("run.started", {}, "lead"),
			progress("lead", "router"),
			progress("gone", "docs"),
		].reduce(foldEvent, emptyFold());
		const board = statusBoard(fold);
		expect(board.sessions[0]?.team).toMatchObject({
			subject: "team:router",
			state: "blocked",
			blockedTasks: 1,
		});
		expect(board.teams.map((row) => [row.subject, row.sessionId])).toEqual([
			["team:docs", "gone"],
		]);
	});
});
