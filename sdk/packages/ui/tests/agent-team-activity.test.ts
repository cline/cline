import { describe, expect, it } from "vitest";
import {
	type AgentTeamLiveActivity,
	type AgentTeamRun,
	agentTeamLiveActivityFromLifecycle,
	agentTeamPhaseForTool,
	agentTeamPhaseFromLiveActivity,
	buildAgentTeamMembers,
	changesAgentTeamRoster,
	isAgentTeamSettled,
	shouldReplaceAgentTeamLiveActivity,
	summarizeAgentTeam,
} from "../components/agent-team-activity.js";

function entry(
	overrides: Partial<AgentTeamRun> & { agentId: string },
): AgentTeamRun {
	return {
		sessionId: `root__teamtask__${overrides.agentId}_1`,
		kind: "teamtask",
		status: "running",
		startedAt: "2026-10-20T20:00:00.000Z",
		...overrides,
	};
}

describe("agentTeamPhaseForTool", () => {
	it("separates reading, editing, running, and coordinating", () => {
		expect(agentTeamPhaseForTool("read_files")).toBe("reading");
		expect(agentTeamPhaseForTool("search_codebase")).toBe("reading");
		expect(agentTeamPhaseForTool("editor")).toBe("editing");
		expect(agentTeamPhaseForTool("run_commands")).toBe("running");
		expect(agentTeamPhaseForTool("team_send_message")).toBe("coordinating");
		expect(agentTeamPhaseForTool("team_await_runs")).toBe("waiting");
	});
});

describe("agentTeamPhaseFromLiveActivity", () => {
	const live = (
		eventType: string,
		message?: string,
	): AgentTeamLiveActivity => ({
		eventType,
		message,
		at: 0,
	});

	it("reads the tool out of a run_progress activity", () => {
		expect(
			agentTeamPhaseFromLiveActivity(
				live("run_progress", "running_tool_editor"),
			),
		).toEqual({ phase: "editing", step: "Editing files" });
	});

	it("reads the tool out of a finished-tool activity too", () => {
		expect(
			agentTeamPhaseFromLiveActivity(
				live("run_progress", "finished_tool_run_commands"),
			),
		).toEqual({ phase: "running", step: "Running commands" });
	});

	it("treats a new iteration as thinking", () => {
		expect(
			agentTeamPhaseFromLiveActivity(
				live("run_progress", "iteration_3_started"),
			),
		).toEqual({ phase: "thinking" });
	});

	it("ignores activity it cannot interpret", () => {
		expect(
			agentTeamPhaseFromLiveActivity(live("run_progress", "heartbeat")),
		).toBe(undefined);
		expect(agentTeamPhaseFromLiveActivity(live("outcome_created"))).toBe(
			undefined,
		);
	});
});

describe("changesAgentTeamRoster", () => {
	it("flags joins and run starts and ends, not activity", () => {
		expect(changesAgentTeamRoster("teammate_spawned")).toBe(true);
		expect(changesAgentTeamRoster("run_started")).toBe(true);
		expect(changesAgentTeamRoster("run_completed")).toBe(true);
		expect(changesAgentTeamRoster("task_start")).toBe(true);
		expect(changesAgentTeamRoster("task_end")).toBe(true);
		expect(changesAgentTeamRoster("run_progress")).toBe(false);
		expect(changesAgentTeamRoster("agent_event")).toBe(false);
	});
});

describe("shouldReplaceAgentTeamLiveActivity", () => {
	const live = (
		eventType: string,
		message?: string,
	): AgentTeamLiveActivity => ({
		eventType,
		message,
		at: 0,
	});

	it("keeps the latest tool when the next iteration starts", () => {
		expect(
			shouldReplaceAgentTeamLiveActivity(
				live("run_progress", "finished_tool_editor"),
				live("run_progress", "iteration_4_started"),
			),
		).toBe(false);
	});

	it("lets a first iteration or a new tool through", () => {
		expect(
			shouldReplaceAgentTeamLiveActivity(
				live("run_started"),
				live("run_progress", "iteration_1_started"),
			),
		).toBe(true);
		expect(
			shouldReplaceAgentTeamLiveActivity(
				live("run_progress", "finished_tool_editor"),
				live("run_progress", "running_tool_run_commands"),
			),
		).toBe(true);
	});

	it("ignores events it cannot interpret", () => {
		expect(
			shouldReplaceAgentTeamLiveActivity(
				undefined,
				live("run_progress", "heartbeat"),
			),
		).toBe(false);
		expect(
			shouldReplaceAgentTeamLiveActivity(undefined, live("agent_event")),
		).toBe(false);
	});
});

describe("buildAgentTeamMembers", () => {
	it("keeps team-task runs and drops subagents", () => {
		const members = buildAgentTeamMembers([
			entry({ agentId: "architect" }),
			entry({ agentId: "helper", kind: "subagent" }),
		]);
		expect(members.map((member) => member.agentId)).toEqual(["architect"]);
	});

	it("shows a teammate by its latest run, timed from its first", () => {
		const [member] = buildAgentTeamMembers([
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
		const [member] = buildAgentTeamMembers([
			entry({
				agentId: "search-dev",
				prompt:
					"Make the search box filter cards by title\n\nCURRENT STATE:\n- ...",
			}),
		]);
		expect(member?.task).toBe("Make the search box filter cards by title");
	});

	it("prefers narration over a tool name for the step", () => {
		const [member] = buildAgentTeamMembers([
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
		const live = new Map<string, AgentTeamLiveActivity>([
			[
				"client-dev",
				{
					eventType: "run_progress",
					message: "running_tool_editor",
					at: Date.parse("2026-10-20T20:01:00.000Z"),
				},
			],
		]);
		const [member] = buildAgentTeamMembers(
			[entry({ agentId: "client-dev", lastAction: "Running read_files" })],
			live,
		);
		expect(member).toMatchObject({ phase: "editing", step: "Editing files" });
	});

	it("ignores live activity from before the latest run started", () => {
		const live = new Map<string, AgentTeamLiveActivity>([
			[
				"client-dev",
				{
					eventType: "run_completed",
					at: Date.parse("2026-10-20T19:00:00.000Z"),
				},
			],
		]);
		const [member] = buildAgentTeamMembers(
			[entry({ agentId: "client-dev", lastAction: "Running editor" })],
			live,
		);
		expect(member?.phase).toBe("editing");
	});

	it("trusts a settled status over live activity", () => {
		const live = new Map<string, AgentTeamLiveActivity>([
			[
				"reviewer",
				{
					eventType: "run_progress",
					message: "running_tool_read_files",
					at: Date.parse("2026-10-20T20:10:00.000Z"),
				},
			],
		]);
		const [member] = buildAgentTeamMembers(
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
	const members = buildAgentTeamMembers([
		entry({ agentId: "a", lastAction: "Running read_files" }),
		entry({ agentId: "b", lastAction: "Running editor" }),
		entry({ agentId: "c", lastAction: "Running run_commands" }),
		entry({ agentId: "d", status: "completed" }),
	]);

	it("counts planning, acting, and done teammates", () => {
		expect(summarizeAgentTeam(members)).toBe("1 planning · 2 acting · 1 done");
	});

	it("is settled only when every teammate has finished", () => {
		expect(isAgentTeamSettled(members)).toBe(false);
		expect(
			isAgentTeamSettled(
				buildAgentTeamMembers([
					entry({ agentId: "a", status: "completed" }),
					entry({ agentId: "b", status: "failed" }),
				]),
			),
		).toBe(true);
	});
});

describe("agentTeamLiveActivityFromLifecycle", () => {
	it("keeps the agent, event, and message of a lifecycle event", () => {
		expect(
			agentTeamLiveActivityFromLifecycle(
				{
					agentId: "reviewer",
					eventType: "run_progress",
					message: "running_tool_editor",
				},
				42,
			),
		).toEqual({
			agentId: "reviewer",
			eventType: "run_progress",
			message: "running_tool_editor",
			at: 42,
		});
	});

	it("drops events without an agent", () => {
		expect(
			agentTeamLiveActivityFromLifecycle({ eventType: "outcome_created" }, 0),
		).toBeUndefined();
	});
});
