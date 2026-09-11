import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	ComputerUserCoordinator,
	type ComputerUserSessionHost,
} from "./coordinator";
import { createComputerUserCollaborationTools } from "./helper-tools";

const ctx: AgentToolContext = {
	agentId: "helper-agent",
	conversationId: "conv-1",
	iteration: 1,
};

function makeIdleHost(): ComputerUserSessionHost {
	return {
		start: async () => ({ sessionId: "helper-session" }),
		send: async () => undefined,
		abort: async () => {},
		stop: async () => {},
	};
}

describe("computer-user collaboration tools", () => {
	it("terminal tools complete the run; the update tool does not", () => {
		const coordinator = new ComputerUserCoordinator({
			host: makeIdleHost(),
			helperConfig: {},
			emitSteerMessage: () => {},
		});
		const tools = createComputerUserCollaborationTools(coordinator);
		const byName = new Map(tools.map((tool) => [tool.name, tool]));

		expect(byName.get("post_driver_update")?.lifecycle?.completesRun).not.toBe(
			true,
		);
		expect(byName.get("ask_driver")?.lifecycle?.completesRun).toBe(true);
		expect(byName.get("finish_computer_task")?.lifecycle?.completesRun).toBe(
			true,
		);
	});

	it("post_driver_update steers every note to the driver", async () => {
		const driverMessages: string[] = [];
		const coordinator = new ComputerUserCoordinator({
			host: makeIdleHost(),
			helperConfig: {},
			emitSteerMessage: (prompt) => driverMessages.push(prompt),
		});
		const tools = createComputerUserCollaborationTools(coordinator);
		const update = tools.find((tool) => tool.name === "post_driver_update");

		await update?.execute(
			{ kind: "progress", message: "opened the dashboard" },
			ctx,
		);
		expect(driverMessages).toEqual([
			"[COMPUTER USER PROGRESS] opened the dashboard",
		]);

		await update?.execute(
			{ kind: "warning", message: "an unexpected login prompt appeared" },
			ctx,
		);
		expect(driverMessages).toHaveLength(2);
		expect(driverMessages[1]).toContain("[COMPUTER USER WARNING]");
	});

	it("ask_driver stashes the question the settle path delivers", async () => {
		const coordinator = new ComputerUserCoordinator({
			host: makeIdleHost(),
			helperConfig: {},
			emitSteerMessage: () => {},
		});
		const tools = createComputerUserCollaborationTools(coordinator);
		const ask = tools.find((tool) => tool.name === "ask_driver");

		const output = await ask?.execute(
			{
				question: "Replace or Merge?",
				context: "The import dialog offers two options.",
				options: ["Replace", "Merge"],
			},
			ctx,
		);
		expect(output).toEqual({ delivered: true });
	});
});
