import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type {
	ComputerBackendEnsureResult,
	ComputerBackendRestartCapability,
} from "./backend-restart";
import { createComputerBackendRestartTool } from "./backend-restart-tool";

const context: AgentToolContext = {
	agentId: "driver",
	conversationId: "conversation",
	iteration: 1,
};

describe("createComputerBackendRestartTool", () => {
	it.each<ComputerBackendEnsureResult>([
		{ status: "started" },
		{ status: "already_running" },
		{ status: "failed_to_start", error: "backend did not answer" },
	])("reports $status and forwards cancellation", async (result) => {
		const forceRestart = vi.fn(async () => result);
		const capability: ComputerBackendRestartCapability = {
			budgetMs: 1_000,
			ensureRunning: async () => ({ status: "already_running" }),
			forceRestart,
		};
		const tool = createComputerBackendRestartTool(capability);
		const controller = new AbortController();

		expect(tool.name).toBe("computer_restart_backend");
		expect(tool.timeoutMs).toBe(61_000);
		expect(tool.retryable).toBe(false);
		const output = await tool.execute(
			{},
			{ ...context, signal: controller.signal },
		);

		expect(forceRestart).toHaveBeenCalledExactlyOnceWith(controller.signal);
		expect(output).toMatchObject(result);
		if (result.status === "failed_to_start") {
			expect(output).toMatchObject({
				note: expect.stringContaining("did not complete"),
			});
		} else {
			expect(output).toMatchObject({
				note: expect.stringContaining("fresh screenshot"),
			});
		}
	});

	it("rejects unsupported input before restarting", async () => {
		const forceRestart = vi.fn(async () => ({ status: "started" as const }));
		const tool = createComputerBackendRestartTool({
			budgetMs: 1_000,
			ensureRunning: async () => ({ status: "already_running" }),
			forceRestart,
		});

		await expect(
			tool.execute({ command: "other command" }, context),
		).rejects.toThrow();
		expect(forceRestart).not.toHaveBeenCalled();
	});
});
