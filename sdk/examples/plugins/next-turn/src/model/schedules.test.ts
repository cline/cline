import { describe, expect, test } from "bun:test";
import { emptyFold, foldEvent, foldEvents } from "../hub/fold";
import type { HubEvent } from "../hub/link";
import { seedExecutions, seedUpcoming } from "../hub/seed";
import { needsYou } from "./needs-you";
import { teamSummary, upcomingRuns } from "./schedules";
import { statusBoard } from "./session-rows";

let seq = 0;
function ev(
	event: string,
	payload: Record<string, unknown> = {},
	sessionId?: string,
): HubEvent {
	seq += 1;
	return { event, sequence: seq, sessionId, timestamp: seq * 1000, payload };
}

describe("schedules", () => {
	test("upcoming runs come soonest first with their names, and refresh on every seed", () => {
		const once = seedUpcoming(emptyFold(), {
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
		expect(upcomingRuns(once).map((run) => run.name)).toEqual([
			"Nightly checks",
			"Weekly audit",
		]);
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

	test("the seed keeps each schedule's latest execution, and live events win", () => {
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

	test("a failed run attaches to its session's row, or stands alone, and needs the person", () => {
		const fold = foldEvents(
			seedUpcoming(emptyFold(), {
				runs: [
					{ scheduleId: "nightly", name: "Nightly checks", nextRunAt: "x" },
				],
			}),
			[
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
			],
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
		const fold = foldEvents(emptyFold(), [
			ev("run.started", {}, "lead"),
			progress("lead", "router"),
			progress("gone", "docs"),
		]);
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
