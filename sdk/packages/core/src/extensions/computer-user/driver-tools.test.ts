import type { AgentResult, AgentToolContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	ComputerUserCoordinator,
	type ComputerUserSessionHost,
} from "./coordinator";
import {
	type ComputerBackendRestartCapability,
	createComputerUserDriverTools,
} from "./driver-tools";
import {
	type ComputerUserTranscriptEntry,
	ComputerUserTranscriptLog,
} from "./transcript-log";

const ctx: AgentToolContext = {
	agentId: "driver-agent",
	conversationId: "conv-1",
	iteration: 1,
};

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "done",
		iterations: 1,
		finishReason: "completed",
		messages: [],
		toolCalls: [],
		usage: { inputTokens: 1, outputTokens: 1 },
		...overrides,
	} as AgentResult;
}

function makeHarness() {
	const pendingSends: Array<{
		resolve: (result: AgentResult | undefined) => void;
	}> = [];
	const host: ComputerUserSessionHost = {
		start: async () => ({ sessionId: "helper-session" }),
		send: (input) => {
			if (input.delivery === "steer") {
				return Promise.resolve(undefined);
			}
			return new Promise((resolve) => {
				pendingSends.push({ resolve });
			});
		},
		abort: async () => {},
		stop: async () => {},
	};
	const driverMessages: string[] = [];
	const coordinator = new ComputerUserCoordinator({
		host,
		helperConfig: {},
		notifyDriver: (input) => driverMessages.push(input.prompt),
	});
	const tools = createComputerUserDriverTools(coordinator);
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	return { coordinator, byName, pendingSends, driverMessages };
}

describe("computer-user driver tools", () => {
	it("start returns immediately with ids while the helper keeps running", async () => {
		const { byName, coordinator } = makeHarness();
		const output = (await byName
			.get("computer_user_start")
			?.execute({ task: "open the dashboard" }, ctx)) as Record<
			string,
			unknown
		>;
		expect(output.status).toBe("started");
		expect(output.sessionId).toBe("helper-session");
		expect(output.runId).toMatch(/^curun_/);
		expect(coordinator.getState().kind).toBe("running");
	});

	it("status surfaces the coordinator's summary", async () => {
		const { byName, coordinator } = makeHarness();
		await byName.get("computer_user_start")?.execute({ task: "task" }, ctx);
		coordinator.onHelperNote({ kind: "progress", text: "logging in" });
		const output = (await byName
			.get("computer_user_status")
			?.execute({}, ctx)) as { summary: string; state: string };
		expect(output.state).toBe("running");
		expect(output.summary).toContain("logging in");
	});

	it("status advertises its revision cursor and bounded wait", () => {
		const { byName } = makeHarness();
		const statusTool = byName.get("computer_user_status");

		expect(statusTool?.inputSchema).toMatchObject({
			type: "object",
			properties: {
				since: { type: "integer", minimum: 0 },
				timeout: { type: "number", minimum: 0, maximum: 120 },
			},
			additionalProperties: false,
		});
		expect(statusTool?.timeoutMs).toBe(125_000);
		expect(statusTool?.retryable).toBe(false);
	});

	it("status waits from a returned revision until the coordinator changes", async () => {
		const { byName, coordinator } = makeHarness();
		await byName.get("computer_user_start")?.execute({ task: "task" }, ctx);
		const statusTool = byName.get("computer_user_status");
		const initial = (await statusTool?.execute({}, ctx)) as {
			revision: number;
		};
		const waiting = statusTool?.execute(
			{ since: initial.revision, timeout: 10 },
			ctx,
		) as Promise<{ revision: number; latestNote?: { text: string } }>;

		coordinator.onHelperNote({ kind: "progress", text: "found the dialog" });

		await expect(waiting).resolves.toMatchObject({
			revision: initial.revision + 1,
			latestNote: { text: "found the dialog" },
		});
	});

	it("status rejects timeout without since", async () => {
		const { byName } = makeHarness();

		await expect(
			byName.get("computer_user_status")?.execute({ timeout: 1 }, ctx),
		).rejects.toThrow("timeout requires since");
	});

	it("message reports steer vs new_turn delivery honestly", async () => {
		const { byName, pendingSends } = makeHarness();
		await byName.get("computer_user_start")?.execute({ task: "task" }, ctx);

		const steered = (await byName
			.get("computer_user_message")
			?.execute({ message: "zoom into the modal" }, ctx)) as {
			delivered: string;
		};
		expect(steered.delivered).toBe("steer");

		pendingSends[0]?.resolve(makeResult());
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		const newTurn = (await byName
			.get("computer_user_message")
			?.execute({ message: "now check the logs" }, ctx)) as {
			delivered: string;
		};
		expect(newTurn.delivered).toBe("new_turn");
	});

	it("interrupt distinguishes running from not_running", async () => {
		const { byName, coordinator, pendingSends } = makeHarness();
		const idle = (await byName
			.get("computer_user_interrupt")
			?.execute({}, ctx)) as { status: string };
		expect(idle.status).toBe("not_running");

		await byName.get("computer_user_start")?.execute({ task: "task" }, ctx);
		const activePromise = byName
			.get("computer_user_interrupt")
			?.execute({ reason: "wrong window" }, ctx) as Promise<{ status: string }>;
		pendingSends[0]?.resolve(makeResult({ finishReason: "aborted" }));
		await expect(activePromise).resolves.toMatchObject({ status: "stopped" });
		expect(coordinator.getState().kind).toBe("idle");
	});

	it("start surfaces the busy error as a thrown error, not success", async () => {
		const { byName } = makeHarness();
		await byName.get("computer_user_start")?.execute({ task: "one" }, ctx);
		await expect(
			byName.get("computer_user_start")?.execute({ task: "two" }, ctx),
		).rejects.toThrow(/busy/);
	});

	it("restart returns the helper to uninitialized and the next start binds a fresh session", async () => {
		const calls: string[] = [];
		let nextSession = 0;
		const host: ComputerUserSessionHost = {
			start: async () => {
				nextSession += 1;
				calls.push(`start:${nextSession}`);
				return { sessionId: `helper-session-${nextSession}` };
			},
			send: (input) => {
				if (input.delivery === "steer") {
					return Promise.resolve(undefined);
				}
				return new Promise(() => {});
			},
			abort: async (sessionId) => {
				calls.push(`abort:${sessionId}`);
			},
			stop: async (sessionId) => {
				calls.push(`stop:${sessionId}`);
			},
		};
		const coordinator = new ComputerUserCoordinator({
			host,
			helperConfig: {},
			notifyDriver: () => {},
		});
		const tools = createComputerUserDriverTools(coordinator);
		const byName = new Map(tools.map((tool) => [tool.name, tool]));

		await byName.get("computer_user_start")?.execute({ task: "one" }, ctx);
		expect(calls).toEqual(["start:1"]);

		const output = (await byName
			.get("computer_user_restart")
			?.execute({ reason: "degraded" }, ctx)) as { status: string };
		expect(output.status).toBe("restarted");
		expect(calls).toEqual([
			"start:1",
			"abort:helper-session-1",
			"stop:helper-session-1",
		]);
		expect(coordinator.getState().kind).toBe("uninitialized");

		const second = (await byName
			.get("computer_user_start")
			?.execute({ task: "two" }, ctx)) as { sessionId: string };
		expect(second.sessionId).toBe("helper-session-2");
		expect(calls).toEqual([
			"start:1",
			"abort:helper-session-1",
			"stop:helper-session-1",
			"start:2",
		]);
	});

	it.each([
		"abort",
		"stop",
	] as const)("does not report restarted when %s fails", async (failure) => {
		const host: ComputerUserSessionHost = {
			start: async () => ({ sessionId: "helper-session" }),
			send: () => new Promise(() => {}),
			abort: async () => {
				if (failure === "abort") throw new Error("abort failed");
			},
			stop: async () => {
				if (failure === "stop") throw new Error("stop failed");
			},
		};
		const coordinator = new ComputerUserCoordinator({
			host,
			helperConfig: {},
			notifyDriver: () => {},
		});
		const restart = createComputerUserDriverTools(coordinator).find(
			(tool) => tool.name === "computer_user_restart",
		);
		if (!restart) throw new Error("missing restart tool");
		await coordinator.start("task");
		const state = coordinator.getState();
		await expect(restart.execute({}, ctx)).rejects.toThrow(`${failure} failed`);
		expect(coordinator.getState()).toBe(state);
	});

	it("restart ignores a stale run settlement, so a wedged turn cannot resurrect state", async () => {
		const pendingSends: Array<{
			resolve: (result: AgentResult | undefined) => void;
		}> = [];
		const host: ComputerUserSessionHost = {
			start: async () => ({ sessionId: "helper-session" }),
			send: (input) => {
				if (input.delivery === "steer") {
					return Promise.resolve(undefined);
				}
				return new Promise((resolve) => {
					pendingSends.push({ resolve });
				});
			},
			abort: async () => {},
			stop: async () => {},
		};
		const coordinator = new ComputerUserCoordinator({
			host,
			helperConfig: {},
			notifyDriver: () => {},
		});
		const tools = createComputerUserDriverTools(coordinator);
		const byName = new Map(tools.map((tool) => [tool.name, tool]));

		await byName.get("computer_user_start")?.execute({ task: "one" }, ctx);
		await byName.get("computer_user_restart")?.execute({}, ctx);
		expect(coordinator.getState().kind).toBe("uninitialized");

		// The aborted run settles late; the reset state must survive it.
		pendingSends[0]?.resolve(makeResult());
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(coordinator.getState().kind).toBe("uninitialized");
	});

	it("restart reports not_restarted once disposed", async () => {
		const { byName, coordinator } = makeHarness();
		await coordinator.dispose();
		const output = (await byName
			.get("computer_user_restart")
			?.execute({}, ctx)) as { status: string };
		expect(output.status).toBe("not_restarted");
	});

	it("transcript pages entries through the coordinator's log with sinceSeq", async () => {
		const transcriptLog = new ComputerUserTranscriptLog();
		const host: ComputerUserSessionHost = {
			start: async () => ({ sessionId: "helper-session" }),
			send: async () => undefined,
			abort: async () => {},
			stop: async () => {},
		};
		const coordinator = new ComputerUserCoordinator({
			host,
			helperConfig: {},
			notifyDriver: () => {},
			transcriptLog,
		});
		const tools = createComputerUserDriverTools(coordinator);
		const transcriptTool = tools.find(
			(tool) => tool.name === "computer_user_transcript",
		);
		expect(transcriptTool).toBeDefined();

		const append = (text: string) => {
			transcriptLog.append({
				version: 1,
				artifactId: "art_test",
				eventId: `evt_${text}`,
				clientSequence: 1,
				occurredAt: new Date().toISOString(),
				source: { kind: "computer_user", sessionId: "helper-session" },
				type: "transcript.message_committed",
				payload: { role: "assistant", text },
			});
		};
		append("first");
		append("second");

		const first = (await transcriptTool?.execute({}, ctx)) as {
			entries: ComputerUserTranscriptEntry[];
			latestSeq: number;
		};
		expect(first.entries.map((entry) => entry.text)).toEqual([
			"first",
			"second",
		]);

		append("third");
		const next = (await transcriptTool?.execute(
			{ sinceSeq: first.latestSeq },
			ctx,
		)) as { entries: ComputerUserTranscriptEntry[] };
		expect(next.entries.map((entry) => entry.text)).toEqual(["third"]);
	});

	it("transcript reports when recording is not enabled", async () => {
		const { byName } = makeHarness();
		const output = (await byName
			.get("computer_user_transcript")
			?.execute({}, ctx)) as { entries: unknown[]; note: string };
		expect(output.entries).toEqual([]);
		expect(output.note).toContain("not enabled");
	});

	it("restarts the backend only when the capability is wired in", async () => {
		const { byName } = makeHarness();
		expect(byName.has("computer_user_restart_backend")).toBe(false);

		const results: string[] = [];
		const controller = new AbortController();
		const capability: ComputerBackendRestartCapability = {
			budgetMs: 1_000,
			ensureRunning: async (signal) => {
				expect(signal).toBe(controller.signal);
				const status = results.length === 0 ? "started" : "already_running";
				results.push(status);
				return { status } as
					| { status: "started" }
					| { status: "already_running" };
			},
			dispose: async () => {},
		};
		const host: ComputerUserSessionHost = {
			start: async () => ({ sessionId: "helper-session" }),
			send: async () => undefined,
			abort: async () => {},
			stop: async () => {},
		};
		const coordinator = new ComputerUserCoordinator({
			host,
			helperConfig: {},
			notifyDriver: () => {},
		});
		const tools = createComputerUserDriverTools(coordinator, {
			backendRestart: capability,
		});
		const backendTool = tools.find(
			(tool) => tool.name === "computer_user_restart_backend",
		);
		expect(backendTool).toBeDefined();
		expect(backendTool?.timeoutMs).toBe(61_000);

		const started = (await backendTool?.execute(
			{},
			{ ...ctx, signal: controller.signal },
		)) as {
			status: string;
		};
		expect(started.status).toBe("started");
		const second = (await backendTool?.execute(
			{},
			{ ...ctx, signal: controller.signal },
		)) as {
			status: string;
		};
		expect(second.status).toBe("already_running");
		expect(backendTool?.retryable).toBe(false);
	});
});
