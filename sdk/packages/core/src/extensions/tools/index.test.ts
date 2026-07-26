import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { AgentToolContext } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn }));

import { createBuiltinTools } from "./index";

const context: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conversation-1",
	iteration: 1,
};

function createSuccessfulChildProcess(): ChildProcessWithoutNullStreams {
	const child = Object.assign(new EventEmitter(), {
		stdout: new EventEmitter(),
		stderr: new EventEmitter(),
		stdin: new EventEmitter(),
		pid: 123,
		kill: vi.fn(() => true),
	});
	queueMicrotask(() => child.emit("close", 0));
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
		spawn.mockImplementation(() => createSuccessfulChildProcess());
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
			expectedDescription: "Commands run through PowerShell",
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
