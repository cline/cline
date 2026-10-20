import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	agentEntryState,
	buildSessionAgentActivity,
	describeAgentActivity,
	EMPTY_AGENT_ACTIVITY,
	isAgentRunToolName,
	mergeAgentActivity,
	type SessionAgentEntry,
	summarizeAgentEntries,
} from "@/lib/session-agents";

let messageCounter = 0;

function toolMessage(options: {
	toolName: string;
	hookEventName?: string;
	input?: unknown;
	result?: unknown;
	isError?: boolean;
	id?: string;
}): ChatMessage {
	messageCounter += 1;
	const { toolName, hookEventName, input, result, isError } = options;
	return {
		id: options.id ?? `tool_${messageCounter}`,
		sessionId: "session_1",
		role: "tool",
		content: JSON.stringify({
			toolName,
			input: input ?? null,
			result: result ?? null,
			isError: Boolean(isError),
		}),
		createdAt: messageCounter,
		meta: { toolName, hookEventName },
	};
}

function textMessage(role: ChatMessage["role"], content: string): ChatMessage {
	messageCounter += 1;
	return {
		id: `msg_${messageCounter}`,
		sessionId: "session_1",
		role,
		content,
		createdAt: messageCounter,
	};
}

const ACTIVE = { sessionActive: true };

describe("isAgentRunToolName", () => {
	it("recognizes subagent and teammate run tools", () => {
		expect(isAgentRunToolName("spawn_agent")).toBe(true);
		expect(isAgentRunToolName("spawn-agent")).toBe(true);
		expect(isAgentRunToolName("Spawn_Agent")).toBe(true);
		expect(isAgentRunToolName("subagent_code_reviewer")).toBe(true);
		expect(isAgentRunToolName("team_run_task")).toBe(true);
	});

	it("ignores tools that do not start an agent", () => {
		expect(isAgentRunToolName("read_files")).toBe(false);
		expect(isAgentRunToolName("team_status")).toBe(false);
		expect(isAgentRunToolName("team_spawn_teammate")).toBe(false);
		expect(isAgentRunToolName(undefined)).toBe(false);
	});
});

describe("buildSessionAgentActivity", () => {
	it("returns empty activity when nothing spawned an agent", () => {
		const activity = buildSessionAgentActivity(
			[
				textMessage("user", "hello"),
				textMessage("assistant", "hi"),
				toolMessage({
					toolName: "read_files",
					hookEventName: "tool_call_end",
					result: "ok",
				}),
			],
			ACTIVE,
		);
		expect(activity).toEqual(EMPTY_AGENT_ACTIVITY);
	});

	it("counts an in-flight subagent as running", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "tool_call_start",
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, running: 1, completed: 0 });
	});

	it("counts a finished subagent as completed", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "tool_call_end",
					result: { text: "done", iterations: 3, finishReason: "completed" },
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, running: 0, completed: 1 });
	});

	it("counts an errored subagent as failed", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "tool_call_end",
					result: "sub-agent exploded",
					isError: true,
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, failed: 1, completed: 0 });
	});

	it("treats an aborted subagent run as cancelled", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "tool_call_end",
					result: { text: "", iterations: 1, finishReason: "aborted" },
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, cancelled: 1, completed: 0 });
	});

	it("mixes buckets across several subagents", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "tool_call_end",
					result: { finishReason: "completed" },
				}),
				toolMessage({
					toolName: "subagent_reviewer",
					hookEventName: "tool_call_end",
					result: { finishReason: "completed" },
				}),
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "tool_call_end",
					result: "nope",
					isError: true,
				}),
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "tool_call_start",
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({
			total: 4,
			running: 1,
			completed: 2,
			failed: 1,
		});
	});

	it("reports unfinished runs as unresolved once the session is idle", () => {
		const messages = [
			toolMessage({
				toolName: "spawn_agent",
				hookEventName: "history_tool_use",
			}),
		];
		expect(buildSessionAgentActivity(messages, ACTIVE)).toMatchObject({
			total: 1,
			running: 1,
			unresolved: 0,
		});
		expect(
			buildSessionAgentActivity(messages, { sessionActive: false }),
		).toMatchObject({ total: 1, running: 0, unresolved: 1 });
	});

	it("reads a hydrated result that arrives as a JSON string", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "spawn_agent",
					hookEventName: "history_tool_result",
					result: JSON.stringify({ text: "ok", finishReason: "aborted" }),
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, cancelled: 1 });
	});

	it("recovers the tool name from the payload when meta omits it", () => {
		const base = toolMessage({
			toolName: "spawn_agent",
			hookEventName: "tool_call_end",
			result: { finishReason: "completed" },
		});
		const activity = buildSessionAgentActivity(
			[{ ...base, meta: { hookEventName: "tool_call_end" } }],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, completed: 1 });
	});

	it("counts a sync teammate run as completed when its call returns", () => {
		// Sync team_run_task reports status "running" even on success, so the
		// dispatch mode — not the reported status — has to decide the bucket.
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "team_run_task",
					hookEventName: "tool_call_end",
					input: { agentId: "reviewer", runMode: "sync" },
					result: {
						agentId: "reviewer",
						mode: "sync",
						status: "running",
						dispatched: true,
						text: "reviewed",
					},
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, completed: 1, running: 0 });
	});

	it("keeps an async teammate run running until a later report resolves it", () => {
		const dispatch = toolMessage({
			toolName: "team_run_task",
			hookEventName: "tool_call_end",
			input: { agentId: "reviewer", runMode: "async" },
			result: {
				agentId: "reviewer",
				mode: "async",
				status: "queued",
				dispatched: true,
				runId: "run_1",
			},
		});
		expect(buildSessionAgentActivity([dispatch], ACTIVE)).toMatchObject({
			total: 1,
			running: 1,
			completed: 0,
		});

		const awaited = toolMessage({
			toolName: "team_await_runs",
			hookEventName: "tool_call_end",
			result: [{ id: "run_1", agentId: "reviewer", status: "completed" }],
		});
		expect(
			buildSessionAgentActivity([dispatch, awaited], ACTIVE),
		).toMatchObject({ total: 1, running: 0, completed: 1 });
	});

	it("resolves an async run reported as failed by team_list_runs", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "team_run_task",
					hookEventName: "tool_call_end",
					input: { runMode: "async" },
					result: { mode: "async", status: "queued", runId: "run_9" },
				}),
				toolMessage({
					toolName: "team_list_runs",
					hookEventName: "tool_call_end",
					result: [
						{ id: "run_9", status: "failed" },
						{ id: "run_other", status: "completed" },
					],
				}),
			],
			ACTIVE,
		);
		// run_other was never dispatched in this session, so it is not counted.
		expect(activity).toMatchObject({ total: 1, failed: 1, completed: 0 });
	});

	it("treats a cancelled async run as cancelled", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "team_run_task",
					hookEventName: "tool_call_end",
					input: { runMode: "async" },
					result: { mode: "async", status: "queued", runId: "run_2" },
				}),
				toolMessage({
					toolName: "team_cancel_run",
					hookEventName: "tool_call_end",
					result: { runId: "run_2", status: "cancelled" },
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, cancelled: 1, running: 0 });
	});

	it("counts one agent per async dispatch, not two", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "team_run_task",
					hookEventName: "tool_call_end",
					input: { runMode: "async" },
					result: { mode: "async", status: "running", runId: "run_3" },
				}),
			],
			ACTIVE,
		);
		expect(activity.total).toBe(1);
	});

	it("keeps repeated status reports idempotent", () => {
		const dispatch = toolMessage({
			toolName: "team_run_task",
			hookEventName: "tool_call_end",
			input: { runMode: "async" },
			result: { mode: "async", status: "queued", runId: "run_4" },
		});
		const report = () =>
			toolMessage({
				toolName: "team_list_runs",
				hookEventName: "tool_call_end",
				result: [{ id: "run_4", status: "completed" }],
			});
		const activity = buildSessionAgentActivity(
			[dispatch, report(), report()],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, completed: 1 });
	});

	it("counts a failed async dispatch call itself as failed", () => {
		const activity = buildSessionAgentActivity(
			[
				toolMessage({
					toolName: "team_run_task",
					hookEventName: "tool_call_end",
					input: { runMode: "async" },
					result: "unknown teammate",
					isError: true,
				}),
			],
			ACTIVE,
		);
		expect(activity).toMatchObject({ total: 1, failed: 1 });
	});
});

describe("describeAgentActivity", () => {
	it("describes a single running agent", () => {
		expect(
			describeAgentActivity({
				...EMPTY_AGENT_ACTIVITY,
				total: 1,
				running: 1,
			}),
		).toBe("1 agent: 1 running");
	});

	it("lists every non-empty bucket", () => {
		expect(
			describeAgentActivity({
				total: 5,
				running: 1,
				completed: 2,
				failed: 1,
				cancelled: 1,
				unresolved: 0,
			}),
		).toBe("5 agents: 1 running, 2 completed, 1 failed, 1 cancelled");
	});

	it("describes runs with no recorded outcome", () => {
		expect(
			describeAgentActivity({
				...EMPTY_AGENT_ACTIVITY,
				total: 2,
				completed: 1,
				unresolved: 1,
			}),
		).toBe("2 agents: 1 completed, 1 with no recorded outcome");
	});
});

function agentEntry(
	overrides: Partial<SessionAgentEntry> & { agentId: string },
): SessionAgentEntry {
	return {
		sessionId: `root__${overrides.agentId}`,
		kind: "subagent",
		status: "completed",
		startedAt: "2026-07-27T00:00:00.000Z",
		hasMessages: true,
		...overrides,
	};
}

describe("agentEntryState", () => {
	it("maps persisted session statuses onto run buckets", () => {
		expect(agentEntryState("running")).toBe("running");
		expect(agentEntryState("pending")).toBe("running");
		expect(agentEntryState("Completed")).toBe("completed");
		expect(agentEntryState("failed")).toBe("failed");
		expect(agentEntryState("cancelled")).toBe("cancelled");
		expect(agentEntryState("idle")).toBe("unresolved");
		expect(agentEntryState("something-new")).toBe("unresolved");
	});
});

describe("summarizeAgentEntries", () => {
	it("buckets a roster by status", () => {
		expect(
			summarizeAgentEntries([
				agentEntry({ agentId: "a", status: "running" }),
				agentEntry({ agentId: "b", status: "completed" }),
				agentEntry({ agentId: "c", status: "completed" }),
				agentEntry({ agentId: "d", status: "failed" }),
			]),
		).toEqual({
			total: 4,
			running: 1,
			completed: 2,
			failed: 1,
			cancelled: 0,
			unresolved: 0,
		});
	});

	it("returns an empty tally for an empty roster", () => {
		expect(summarizeAgentEntries([])).toEqual(EMPTY_AGENT_ACTIVITY);
	});
});

describe("mergeAgentActivity", () => {
	it("falls back to the derived tally when the roster is empty", () => {
		const derived = { ...EMPTY_AGENT_ACTIVITY, total: 2, running: 2 };
		expect(mergeAgentActivity([], derived, ACTIVE)).toBe(derived);
	});

	it("prefers the roster once it has caught up", () => {
		// The roster knows one run actually failed; the tool tally only saw it end.
		const merged = mergeAgentActivity(
			[
				agentEntry({ agentId: "a", status: "completed" }),
				agentEntry({ agentId: "b", status: "failed" }),
			],
			{ ...EMPTY_AGENT_ACTIVITY, total: 2, completed: 2 },
			ACTIVE,
		);
		expect(merged).toEqual({
			total: 2,
			running: 0,
			completed: 1,
			failed: 1,
			cancelled: 0,
			unresolved: 0,
		});
	});

	it("counts spawns the roster has not recorded yet as running", () => {
		const merged = mergeAgentActivity(
			[agentEntry({ agentId: "a", status: "running" })],
			{ ...EMPTY_AGENT_ACTIVITY, total: 3, running: 3 },
			ACTIVE,
		);
		expect(merged).toMatchObject({ total: 3, running: 3 });
	});

	it("does not report unrecorded spawns as running in an idle session", () => {
		const merged = mergeAgentActivity(
			[agentEntry({ agentId: "a", status: "completed" })],
			{ ...EMPTY_AGENT_ACTIVITY, total: 2, unresolved: 2 },
			{ sessionActive: false },
		);
		expect(merged).toMatchObject({
			total: 2,
			completed: 1,
			running: 0,
			unresolved: 1,
		});
	});

	it("never lets the roster shrink the total below what was observed", () => {
		const merged = mergeAgentActivity(
			[agentEntry({ agentId: "a", status: "completed" })],
			{ ...EMPTY_AGENT_ACTIVITY, total: 4, completed: 4 },
			ACTIVE,
		);
		expect(merged.total).toBe(4);
	});
});
