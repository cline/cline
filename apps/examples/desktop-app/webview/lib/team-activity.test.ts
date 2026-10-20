import { describe, expect, it } from "vitest";
import type { SessionAgentEntry } from "@/lib/session-agents";
import {
	buildTeamMembers,
	isTeamSettled,
	phaseForTool,
	phaseFromLiveActivity,
	summarizeTeam,
	type TeamLiveActivity,
} from "@/lib/team-activity";

function entry(
	overrides: Partial<SessionAgentEntry> & { agentId: string },
): SessionAgentEntry {
	return {
		sessionId: `root__teamtask__${overrides.agentId}_1`,
		kind: "teamtask",
		status: "running",
		startedAt: "2026-10-20T20:00:00.000Z",
		hasMessages: true,
		...overrides,
	};
}

describe("phaseForTool", () => {
	it("separates reading, editing, running, and coordinating", () => {
		expect(phaseForTool("read_files")).toBe("reading");
		expect(phaseForTool("search_codebase")).toBe("reading");
		expect(phaseForTool("editor")).toBe("editing");
		expect(phaseForTool("run_commands")).toBe("running");
		expect(phaseForTool("team_send_message")).toBe("coordinating");
		expect(phaseForTool("team_await_runs")).toBe("waiting");
	});
});

describe("phaseFromLiveActivity", () => {
	const live = (eventType: string, message?: string): TeamLiveActivity => ({
		eventType,
		message,
		at: 0,
	});

	it("reads the tool out of a run_progress activity", () => {
		expect(
			phaseFromLiveActivity(live("run_progress", "running_tool_editor")),
		).toEqual({ phase: "editing", step: "Editing files" });
	});

	it("treats a new iteration as thinking", () => {
		expect(
			phaseFromLiveActivity(live("run_progress", "iteration_3_started")),
		).toEqual({ phase: "thinking" });
	});

	it("ignores activity it cannot interpret", () => {
		expect(phaseFromLiveActivity(live("run_progress", "heartbeat"))).toBe(
			undefined,
		);
		expect(phaseFromLiveActivity(live("outcome_created"))).toBe(undefined);
	});
});

describe("buildTeamMembers", () => {
	it("keeps team-task runs and drops subagents", () => {
		const members = buildTeamMembers([
			entry({ agentId: "architect" }),
			entry({ agentId: "helper", kind: "subagent" }),
		]);
		expect(members.map((member) => member.agentId)).toEqual(["architect"]);
	});

	it("shows a teammate by its latest run, timed from its first", () => {
		const [member] = buildTeamMembers([
			entry({
				agentId: "server-dev",
				sessionId: "run_a",
				status: "completed",
				startedAt: "2026-10-20T20:00:00.000Z",
				endedAt: "2026-10-20T20:02:00.000Z",
			}),
			entry({
				agentId: "server-dev",
				sessionId: "run_b",
				startedAt: "2026-10-20T20:05:00.000Z",
				lastAction: "Running run_commands",
			}),
		]);
		expect(member).toMatchObject({
			sessionId: "run_b",
			phase: "running",
			step: "Running commands",
			startedAt: Date.parse("2026-10-20T20:00:00.000Z"),
		});
	});

	it("names the task by the first line of a multi-line brief", () => {
		const [member] = buildTeamMembers([
			entry({
				agentId: "search-dev",
				prompt:
					"Make the search box filter cards by title\n\nCURRENT STATE:\n- ...",
			}),
		]);
		expect(member?.task).toBe("Make the search box filter cards by title");
	});

	it("prefers narration over a tool name for the step", () => {
		const [member] = buildTeamMembers([
			entry({
				agentId: "architect",
				lastAction: "Comparing ordering strategies before writing the doc.",
			}),
		]);
		expect(member).toMatchObject({
			phase: "thinking",
			step: "Comparing ordering strategies before writing the doc.",
		});
	});

	it("lets newer live activity decide the phase", () => {
		const live = new Map<string, TeamLiveActivity>([
			[
				"client-dev",
				{
					eventType: "run_progress",
					message: "running_tool_editor",
					at: Date.parse("2026-10-20T20:01:00.000Z"),
				},
			],
		]);
		const [member] = buildTeamMembers(
			[entry({ agentId: "client-dev", lastAction: "Running read_files" })],
			live,
		);
		expect(member).toMatchObject({ phase: "editing", step: "Editing files" });
	});

	it("ignores live activity from before the latest run started", () => {
		const live = new Map<string, TeamLiveActivity>([
			[
				"client-dev",
				{
					eventType: "run_completed",
					at: Date.parse("2026-10-20T19:00:00.000Z"),
				},
			],
		]);
		const [member] = buildTeamMembers(
			[entry({ agentId: "client-dev", lastAction: "Running editor" })],
			live,
		);
		expect(member?.phase).toBe("editing");
	});

	it("trusts a settled status over live activity", () => {
		const live = new Map<string, TeamLiveActivity>([
			[
				"reviewer",
				{
					eventType: "run_progress",
					message: "running_tool_read_files",
					at: Date.parse("2026-10-20T20:10:00.000Z"),
				},
			],
		]);
		const [member] = buildTeamMembers(
			[
				entry({
					agentId: "reviewer",
					status: "completed",
					endedAt: "2026-10-20T20:12:00.000Z",
				}),
			],
			live,
		);
		expect(member).toMatchObject({
			phase: "done",
			endedAt: Date.parse("2026-10-20T20:12:00.000Z"),
		});
	});
});

describe("team summary", () => {
	const members = buildTeamMembers([
		entry({ agentId: "a", lastAction: "Running read_files" }),
		entry({ agentId: "b", lastAction: "Running editor" }),
		entry({ agentId: "c", lastAction: "Running run_commands" }),
		entry({ agentId: "d", status: "completed" }),
	]);

	it("counts planning, acting, and done teammates", () => {
		expect(summarizeTeam(members)).toBe("1 planning · 2 acting · 1 done");
	});

	it("is settled only when every teammate has finished", () => {
		expect(isTeamSettled(members)).toBe(false);
		expect(
			isTeamSettled(
				buildTeamMembers([
					entry({ agentId: "a", status: "completed" }),
					entry({ agentId: "b", status: "failed" }),
				]),
			),
		).toBe(true);
	});
});
