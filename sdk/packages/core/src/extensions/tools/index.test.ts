import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { AgentToolContext } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn }));

import {
	CommandTerminationError,
	createBuiltinTools,
	createShellExecutor,
} from "./index";

const context: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conversation-1",
	iteration: 1,
};

const pwshExecutable = process.platform === "win32" ? "pwsh.exe" : "pwsh";

function createChildProcess(
	code: number | null = 0,
	signal: NodeJS.Signals | null = null,
): ChildProcessWithoutNullStreams {
	const child = Object.assign(new EventEmitter(), {
		stdout: new EventEmitter(),
		stderr: new EventEmitter(),
		stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
		pid: 123,
		kill: vi.fn(() => true),
	});
	queueMicrotask(() => child.emit("close", code, signal));
	return child as unknown as ChildProcessWithoutNullStreams;
}

async function executeRunCommands(
	options: Parameters<typeof createBuiltinTools>[0],
) {
	const tool = createBuiltinTools(options).find(
		(candidate) => candidate.name === "run_commands",
	);
	if (!tool) {
		throw new Error("Expected run_commands tool");
	}

	await tool.execute({ commands: ["echo ok"] }, context);
	return tool;
}

describe("createBuiltinTools shell configuration", () => {
	beforeEach(() => {
		spawn.mockReset();
		spawn.mockImplementation(() => createChildProcess());
	});

	it("does not invent an exit code when neither code nor signal is reported", async () => {
		spawn.mockImplementation(() => createChildProcess(null, null));
		const error = await createShellExecutor()(
			"echo ok",
			process.cwd(),
			context,
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CommandTerminationError);
		expect(error).toMatchObject({
			signal: null,
			output: "[Command terminated without an exit code]",
		});
		expect(error).not.toHaveProperty("exitCode");
	});

	it.each([
		{
			name: "top-level shell",
			options: { shell: "cmd.exe" },
			expectedShell: "cmd.exe",
			expectedDescription: "Commands run through cmd.exe",
		},
		{
			name: "executor shell",
			options: { executorOptions: { bash: { shell: "powershell.exe" } } },
			expectedShell: "powershell.exe",
			expectedDescription:
				"Commands run through Windows PowerShell (powershell.exe)",
		},
		{
			name: "pwsh executable",
			options: { shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
			expectedShell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
			expectedDescription: `Commands run through PowerShell (${pwshExecutable})`,
		},
		{
			name: "top-level shell precedence",
			options: {
				shell: "cmd.exe",
				executorOptions: { bash: { shell: "powershell.exe" } },
			},
			expectedShell: "cmd.exe",
			expectedDescription: "Commands run through cmd.exe",
		},
	])("uses the $name for both description and execution", async ({
		options,
		expectedShell,
		expectedDescription,
	}) => {
		const tool = await executeRunCommands(options);

		expect(tool.description).toContain(expectedDescription);
		expect(spawn).toHaveBeenCalledWith(
			expectedShell,
			expect.any(Array),
			expect.any(Object),
		);
	});
});
