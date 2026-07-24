import type { AgentResult, AgentToolContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	ComputerUserCoordinator,
	type ComputerUserSessionHost,
} from "./coordinator";
import { createComputerUserDriverTools } from "./driver-tools";

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
		const { byName } = makeHarness();
		const idle = (await byName
			.get("computer_user_interrupt")
			?.execute({}, ctx)) as { status: string };
		expect(idle.status).toBe("not_running");

		await byName.get("computer_user_start")?.execute({ task: "task" }, ctx);
		const active = (await byName
			.get("computer_user_interrupt")
			?.execute({ reason: "wrong window" }, ctx)) as { status: string };
		expect(active.status).toBe("interrupting");
	});

	it("start surfaces the busy error as a thrown error, not success", async () => {
		const { byName } = makeHarness();
		await byName.get("computer_user_start")?.execute({ task: "one" }, ctx);
		await expect(
			byName.get("computer_user_start")?.execute({ task: "two" }, ctx),
		).rejects.toThrow(/busy/);
	});
});
