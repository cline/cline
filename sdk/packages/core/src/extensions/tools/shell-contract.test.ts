import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	CommandSpawnError,
	CommandTerminationError,
	createBuiltinTools,
	createShellExecutor,
} from "../../index";

const context: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conversation-1",
	iteration: 1,
};

describe("public shell error boundary", () => {
	it("rejects at the executor but returns a failed run_commands result for a missing shell", async () => {
		const shell = join(tmpdir(), `cline-missing-shell-${randomUUID()}`);
		const executor = createShellExecutor({ shell });
		const error = await executor("echo ok", process.cwd(), context).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(CommandSpawnError);
		expect(error).toMatchObject({ code: "ENOENT", missing: "executable" });
		expect(error).not.toHaveProperty("exitCode");

		const tool = createBuiltinTools({ shell, cwd: process.cwd() }).find(
			(candidate) => candidate.name === "run_commands",
		);
		if (!tool) throw new Error("Expected run_commands tool");
		await expect(
			tool.execute({ commands: ["echo ok"] }, context),
		).resolves.toEqual([
			{
				query: "echo ok",
				result: "",
				error: expect.stringContaining("Failed to execute command:"),
				success: false,
			},
		]);
	});

	it.skipIf(process.platform === "win32")(
		"preserves signal termination and captured output across the public tool boundary",
		async () => {
			const command = {
				command: process.execPath,
				args: [
					"-e",
					"process.stdout.write('partial output', () => process.kill(process.pid, 'SIGTERM'))",
				],
			};
			const executor = createShellExecutor();
			const error = await executor(command, process.cwd(), context).catch(
				(caught: unknown) => caught,
			);
			expect(error).toBeInstanceOf(CommandTerminationError);
			expect(error).not.toHaveProperty("exitCode");

			const tool = createBuiltinTools({ cwd: process.cwd() }).find(
				(candidate) => candidate.name === "run_commands",
			);
			if (!tool) throw new Error("Expected run_commands tool");
			await expect(
				tool.execute({ commands: [command] }, context),
			).resolves.toEqual([
				{
					query: expect.any(String),
					result: "[Command terminated by signal SIGTERM]\npartial output",
					error: "Command terminated by signal SIGTERM",
					success: false,
				},
			]);
		},
	);
});
