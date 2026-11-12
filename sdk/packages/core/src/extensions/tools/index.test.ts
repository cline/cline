import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { AgentToolContext } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawn }));

import { ToolResultCache } from "../../session/services/tool-result-cache";

import {
	CommandTerminationError,
	createDefaultExecutors,
	createDefaultTools,
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

describe("default read_files working directory", () => {
	it.each([
		"builtin",
		"separate-defaults",
	])("reads assigned workspace content through %s assembly while preserving external and cached paths", async (assembly) => {
		const root = await mkdtemp(join(tmpdir(), "cline-read-cwd-"));
		const hub = join(root, "hub");
		const assigned = join(root, "assigned");
		const filename = "same-name.txt";
		await Promise.all([mkdir(hub), mkdir(assigned)]);
		await Promise.all([
			writeFile(join(hub, filename), "hub copy"),
			writeFile(join(assigned, filename), "assigned copy"),
		]);
		const processCwd = vi.spyOn(process, "cwd").mockReturnValue(hub);
		try {
			const tools =
				assembly === "builtin"
					? createBuiltinTools({ cwd: assigned })
					: createDefaultTools({
							cwd: assigned,
							executors: createDefaultExecutors(),
						});
			const reader = tools.find((tool) => tool.name === "read_files");
			if (!reader) throw new Error("Expected read_files tool");
			const cache = new ToolResultCache("read-cwd-session");
			const uri = cache.store("cached-call", "cached copy");
			if (!uri) throw new Error("Expected cached result URI");
			const result = await reader.execute(
				{
					files: [
						{ path: filename },
						{ path: join(hub, filename) },
						{ path: uri },
					],
				},
				{ ...context, metadata: { toolResultCache: cache } },
			);
			expect(result).toEqual([
				{ query: filename, result: "1 | assigned copy", success: true },
				{ query: join(hub, filename), result: "1 | hub copy", success: true },
				{ query: uri, result: "1 | cached copy", success: true },
			]);
		} finally {
			processCwd.mockRestore();
			await rm(root, { recursive: true, force: true });
		}
	});
});
