import { describe, expect, it } from "vitest";
import type { SessionThread } from "@/hooks/use-session-history";
import {
	groupScheduledThreads,
	groupThreadsByProject,
	scheduleRunLabel,
	workspaceDisplayName,
} from "./sidebar-session-organization";

function thread(
	id: string,
	workspacePath: string,
	overrides: Partial<SessionThread> = {},
): SessionThread {
	return {
		id,
		title: id,
		codebase: workspaceDisplayName(workspacePath),
		workspacePath,
		time: "now",
		provider: "cline",
		model: "test-model",
		status: "completed",
		isScheduled: false,
		...overrides,
	};
}

describe("sidebar session organization", () => {
	it("groups every loaded thread before applying per-project visibility", () => {
		const threads = [
			...Array.from({ length: 12 }, (_, index) =>
				thread(`alpha-${index + 1}`, "/work/acme/repo"),
			),
			thread("beta-1", "/work/other/repo"),
		];

		const groups = groupThreadsByProject(threads);

		expect(groups.map((group) => group.label)).toEqual([
			"acme/repo",
			"other/repo",
		]);
		expect(groups[0]?.threads).toHaveLength(12);
		expect(groups[1]?.threads.map((item) => item.id)).toEqual(["beta-1"]);
	});

	it("uses the repository directory instead of the full workspace path", () => {
		expect(workspaceDisplayName("/Users/saoud/code/cline/")).toBe("cline");
		expect(workspaceDisplayName("C:\\Users\\saoud\\code\\cline\\")).toBe(
			"cline",
		);
	});

	it("labels chat workspace groups as Chat", () => {
		const path = "/home/host/.cline/data/workspaces/chat";
		expect(workspaceDisplayName(path)).toBe("Chat");
		expect(groupThreadsByProject([thread("temp", path)])[0]?.label).toBe(
			"Chat",
		);
	});

	it("folds scheduled runs into one group per schedule at the newest run's position", () => {
		const scheduled = (id: string, runNumber: number) =>
			thread(id, "/work/acme/repo", {
				title: "Report today's date",
				isScheduled: true,
				scheduleId: "sched_daily",
				scheduleName: "Daily date report",
				scheduleRunNumber: runNumber,
			});
		const rows = groupScheduledThreads([
			thread("task-1", "/work/acme/repo"),
			scheduled("run-3", 3),
			thread("task-2", "/work/acme/repo"),
			scheduled("run-2", 2),
			thread("other-1", "/work/acme/repo", {
				isScheduled: true,
				scheduleId: "sched_other",
				scheduleName: "Other schedule",
			}),
			scheduled("run-1", 1),
		]);

		expect(
			rows.map((row) =>
				row.kind === "thread"
					? row.thread.id
					: `${row.label}[${row.threads.map((t) => t.id).join(",")}]`,
			),
		).toEqual([
			"task-1",
			"Daily date report[run-3,run-2,run-1]",
			"task-2",
			"Other schedule[other-1]",
		]);
		expect(rows[1]).toMatchObject({
			kind: "schedule",
			id: "schedule:sched_daily",
		});
	});

	it("groups un-stamped scheduled runs by their shared title", () => {
		const legacy = (id: string) =>
			thread(id, "/work/acme/repo", {
				title: "Report today's date to the user.",
				isScheduled: true,
			});
		const rows = groupScheduledThreads([
			legacy("legacy-2"),
			thread("named-1", "/work/acme/repo", {
				title: "Report today's date to the user.",
				isScheduled: true,
				scheduleId: "sched_daily",
				scheduleName: "Daily date report",
			}),
			legacy("legacy-1"),
		]);

		// Runs with a schedule id never merge into the title-keyed group.
		expect(
			rows.map((row) =>
				row.kind === "schedule"
					? `${row.id}:${row.threads.length}`
					: row.thread.id,
			),
		).toEqual([
			"title:report today's date to the user.:2",
			"schedule:sched_daily:1",
		]);
		expect(rows[0]).toMatchObject({
			label: "Report today's date to the user.",
		});
	});

	it("labels runs by number and falls back to the start time", () => {
		expect(
			scheduleRunLabel(
				thread("a", "/ws", { isScheduled: true, scheduleRunNumber: 7 }),
			),
		).toBe("Run 7");
		const dated = scheduleRunLabel(
			thread("b", "/ws", {
				isScheduled: true,
				startedAt: "2026-08-31T19:31:40.834Z",
			}),
		);
		expect(dated).toMatch(/Aug 31/);
		expect(dated).not.toBe("Run");
		expect(scheduleRunLabel(thread("c", "/ws", { isScheduled: true }))).toBe(
			"Run",
		);
	});
});
