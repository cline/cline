import type { ITelemetryService } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CLINE_INTERNAL_TELEMETRY_METADATA_KEY,
	getToolContextTelemetry,
} from "../../services/telemetry/tool-context";
import {
	buildRunCommandsDescription,
	createDefaultTools,
	createReadFilesTool,
	createSearchTool,
	createShellTool,
	createSkillsTool,
} from "./definitions";
import { CommandExitError } from "./executors/bash";
import { RUN_COMMAND_QUERY_PREVIEW_LIMIT, TimeoutError } from "./helpers";
import { INPUT_ARG_CHAR_LIMIT } from "./schemas";
import type { SkillsExecutorWithMetadata } from "./types";

function hasSchemaKey(value: unknown, key: string): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => hasSchemaKey(item, key));
	}
	if (value && typeof value === "object") {
		return Object.entries(value).some(
			([entryKey, entryValue]) =>
				entryKey === key || hasSchemaKey(entryValue, key),
		);
	}
	return false;
}

function createMockSkillsExecutor(
	fn: (...args: unknown[]) => Promise<string> = async () => "ok",
	configuredSkills?: SkillsExecutorWithMetadata["configuredSkills"],
): SkillsExecutorWithMetadata {
	const executor = fn as SkillsExecutorWithMetadata;
	executor.configuredSkills = configuredSkills;
	return executor;
}

describe("default skills tool", () => {
	it("is included only when enabled with a skills executor", () => {
		const toolsWithoutExecutor = createDefaultTools({
			executors: {},
			enableSkills: true,
		});
		expect(toolsWithoutExecutor.map((tool) => tool.name)).not.toContain(
			"skills",
		);

		const toolsWithExecutor = createDefaultTools({
			executors: {
				skills: createMockSkillsExecutor(),
			},
			enableSkills: true,
		});
		expect(toolsWithExecutor.map((tool) => tool.name)).toContain("skills");
	});

	it("includes configured skill names in description", () => {
		const executor = createMockSkillsExecutor(
			async () => "ok",
			[
				{ id: "commit", name: "commit", disabled: false },
				{
					id: "review-pr",
					name: "review-pr",
					description: "Review a PR",
					disabled: false,
				},
				{ id: "disabled-skill", name: "disabled-skill", disabled: true },
			],
		);
		const tool = createSkillsTool(executor);
		expect(tool.description).toContain("Available skills: commit, review-pr.");
		expect(tool.description).not.toContain("disabled-skill");
	});

	it("omits skill list from description when no skills are configured", () => {
		const executor = createMockSkillsExecutor(async () => "ok");
		const tool = createSkillsTool(executor);
		expect(tool.description).not.toContain("Available skills");
	});

	it("validates and executes skill invocation input", async () => {
		const execute = vi.fn(async () => "loaded");
		const tools = createDefaultTools({
			executors: {
				skills: createMockSkillsExecutor(execute),
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableEditor: false,
			enableSkills: true,
		});
		const skillsTool = tools.find((tool) => tool.name === "skills");
		expect(skillsTool).toBeDefined();
		if (!skillsTool) {
			throw new Error("Expected skills tool to be defined.");
		}

		const result = await skillsTool.execute(
			{ skill: "commit", args: "-m 'fix'" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toBe("loaded");
		expect(execute).toHaveBeenCalledWith(
			"commit",
			"-m 'fix'",
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});
});

describe("default ask_question tool", () => {
	it("is enabled by default when executor is provided", () => {
		const tools = createDefaultTools({
			executors: {
				askQuestion: async () => "ok",
			},
		});
		expect(tools.map((tool) => tool.name)).toContain("ask_question");
	});

	it("is excluded when explicitly disabled", () => {
		const tools = createDefaultTools({
			executors: {
				askQuestion: async () => "ok",
			},
			enableAskQuestion: false,
		});
		expect(tools.map((tool) => tool.name)).not.toContain("ask_question");
	});

	it("is included only when enabled with an askQuestion executor", () => {
		const toolsWithoutExecutor = createDefaultTools({
			executors: {},
			enableAskQuestion: true,
		});
		expect(toolsWithoutExecutor.map((tool) => tool.name)).not.toContain(
			"ask_question",
		);

		const toolsWithExecutor = createDefaultTools({
			executors: {
				askQuestion: async () => "ok",
			},
			enableAskQuestion: true,
		});
		expect(toolsWithExecutor.map((tool) => tool.name)).toContain(
			"ask_question",
		);
	});

	it("validates and executes ask_question input", async () => {
		const execute = vi.fn(async () => "asked");
		const tools = createDefaultTools({
			executors: {
				askQuestion: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableEditor: false,
			enableSkills: false,
			enableAskQuestion: true,
		});
		const askTool = tools.find((tool) => tool.name === "ask_question");
		expect(askTool).toBeDefined();
		if (!askTool) {
			throw new Error("Expected ask_question tool to be defined.");
		}

		const result = await askTool.execute(
			{
				question: "Which approach should I take?",
				options: ["Option 1", "Option 2"],
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toBe("asked");
		expect(execute).toHaveBeenCalledWith(
			"Which approach should I take?",
			["Option 1", "Option 2"],
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("waits for ask_question answers without timing out", async () => {
		vi.useFakeTimers();
		try {
			let resolveAnswer: (answer: string) => void = () => {};
			const execute = vi.fn(
				() =>
					new Promise<string>((resolve) => {
						resolveAnswer = resolve;
					}),
			);
			const tools = createDefaultTools({
				executors: {
					askQuestion: execute,
				},
				enableReadFiles: false,
				enableSearch: false,
				enableBash: false,
				enableWebFetch: false,
				enableEditor: false,
				enableSkills: false,
				enableAskQuestion: true,
			});
			const askTool = tools.find((tool) => tool.name === "ask_question");
			expect(askTool).toBeDefined();
			if (!askTool) {
				throw new Error("Expected ask_question tool to be defined.");
			}

			const pending = Promise.resolve(
				askTool.execute(
					{
						question: "Which approach should I take?",
						options: ["Option 1", "Option 2"],
					},
					{
						agentId: "agent-1",
						conversationId: "conv-1",
						iteration: 1,
					},
				),
			);
			let settled: unknown;
			pending.then(
				(value) => {
					settled = value;
				},
				(error) => {
					settled = error instanceof Error ? error : new Error(String(error));
				},
			);

			await vi.advanceTimersByTimeAsync(60_000);
			await Promise.resolve();

			expect(settled).toBeUndefined();
			resolveAnswer("Option 2");
			await expect(pending).resolves.toBe("Option 2");
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("default submit_and_exit tool", () => {
	it("is excluded by default even when executor is provided", () => {
		const tools = createDefaultTools({
			executors: {
				submit: async () => "ok",
			},
		});
		expect(tools.map((tool) => tool.name)).not.toContain("submit_and_exit");
	});

	it("is included only when enabled with a submit executor", () => {
		const toolsWithoutExecutor = createDefaultTools({
			executors: {},
			enableSubmitAndExit: true,
		});
		expect(toolsWithoutExecutor.map((tool) => tool.name)).not.toContain(
			"submit_and_exit",
		);

		const toolsWithExecutor = createDefaultTools({
			executors: {
				submit: async () => "ok",
			},
			enableSubmitAndExit: true,
		});
		expect(toolsWithExecutor.map((tool) => tool.name)).toContain(
			"submit_and_exit",
		);
	});

	it("excludes ask_question when submit_and_exit is included", () => {
		const tools = createDefaultTools({
			executors: {
				askQuestion: async () => "answer",
				submit: async () => "submitted",
			},
			enableAskQuestion: true,
			enableSubmitAndExit: true,
		});

		const toolNames = tools.map((tool) => tool.name);
		expect(toolNames).toContain("submit_and_exit");
		expect(toolNames).not.toContain("ask_question");
	});

	it("validates and executes submit_and_exit input", async () => {
		const execute = vi.fn(async () => "submitted");
		const tools = createDefaultTools({
			executors: {
				submit: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableEditor: false,
			enableSkills: false,
			enableAskQuestion: false,
			enableSubmitAndExit: true,
		});
		const submitTool = tools.find((tool) => tool.name === "submit_and_exit");
		expect(submitTool).toBeDefined();
		expect(submitTool?.lifecycle).toEqual({ completesRun: true });
		if (!submitTool) {
			throw new Error("Expected submit_and_exit tool to be defined.");
		}

		const result = await submitTool.execute(
			{
				summary: "Done and verified with the requested checks.",
				verified: true,
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toBe("submitted");
		expect(execute).toHaveBeenCalledWith(
			"Done and verified with the requested checks.",
			true,
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});
});

describe("default search_codebase tool", () => {
	it("treats a valid search with zero matches as success", async () => {
		const noResults =
			"No results found for pattern: missingSymbol\nSearched 3 files.";
		const execute = vi.fn(async () => noResults);
		const tool = createSearchTool(execute);

		const result = await tool.execute(
			{ queries: ["missingSymbol"] },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: "missingSymbol",
				result: noResults,
				success: true,
			},
		]);
	});

	it("treats executor errors as failures", async () => {
		const execute = vi.fn(async () => {
			throw new Error("bad regex");
		});
		const tool = createSearchTool(execute);

		const result = await tool.execute(
			{ queries: ["("] },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: "(",
				result: "",
				error: "Search failed: bad regex",
				success: false,
			},
		]);
	});
});

describe("default apply_patch tool", () => {
	it("is included only when enabled with an applyPatch executor", () => {
		const toolsWithoutExecutor = createDefaultTools({
			executors: {},
			enableApplyPatch: true,
		});
		expect(toolsWithoutExecutor.map((tool) => tool.name)).not.toContain(
			"apply_patch",
		);

		const toolsWithExecutor = createDefaultTools({
			executors: {
				applyPatch: async () => "ok",
			},
			enableApplyPatch: true,
		});
		expect(toolsWithExecutor.map((tool) => tool.name)).toContain("apply_patch");
	});

	it("validates and executes apply_patch input", async () => {
		const execute = vi.fn(async () => "patched");
		const tools = createDefaultTools({
			executors: {
				applyPatch: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableEditor: false,
			enableSkills: false,
			enableAskQuestion: false,
			enableApplyPatch: true,
		});

		const applyPatchTool = tools.find((tool) => tool.name === "apply_patch");
		expect(applyPatchTool).toBeDefined();
		if (!applyPatchTool) {
			throw new Error("Expected apply_patch tool to be defined.");
		}

		const result = await applyPatchTool.execute(
			{ input: "*** Begin Patch\n*** End Patch" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual({
			query: "apply_patch",
			result: "patched",
			success: true,
		});
		expect(execute).toHaveBeenCalledWith(
			{ input: "*** Begin Patch\n*** End Patch" },
			process.cwd(),
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});
});

describe("run_commands tool description", () => {
	it("names PowerShell with ';' sequencing for PowerShell shells", () => {
		const description = buildRunCommandsDescription("powershell", true);
		expect(description).toContain("Commands run through PowerShell");
		expect(description).toContain("use ';' to sequence commands");
		expect(description).toContain("in Windows environment");
	});

	it("names cmd.exe with '&&' sequencing for cmd shells", () => {
		const description = buildRunCommandsDescription("cmd", true);
		expect(description).toContain("Commands run through cmd.exe");
		expect(description).toContain("use '&&' to sequence commands");
		expect(description).not.toContain("PowerShell");
	});

	it("describes WSL bash with the /mnt working-directory mapping", () => {
		const description = buildRunCommandsDescription("wsl", true);
		expect(description).toContain("bash in WSL");
		expect(description).toContain("/mnt/<drive>");
		expect(description).not.toContain("PowerShell");
	});

	it("notes the Windows host for POSIX shells on Windows only", () => {
		const onWindows = buildRunCommandsDescription("posix", true);
		expect(onWindows).toContain("POSIX (bash-compatible) shell on Windows");
		expect(onWindows).not.toContain("PowerShell");

		const onUnix = buildRunCommandsDescription("posix", false);
		expect(onUnix).not.toContain("Windows");
		expect(onUnix).toContain("grep/head/tail");
	});

	it("derives the createShellTool description from config.shell", () => {
		const posixTool = createShellTool(async () => "ok", {
			shell: "/bin/bash",
		});
		expect(posixTool.description).toContain(
			"Run non-interactive shell commands",
		);
		expect(posixTool.description).not.toContain("PowerShell");

		const cmdTool = createShellTool(async () => "ok", {
			shell: "C:\\Windows\\System32\\cmd.exe",
		});
		expect(cmdTool.description).toContain("Commands run through cmd.exe");
	});

	it("re-derives the description on each read when config.shell is a provider", () => {
		let shell = "/bin/bash";
		const tool = createShellTool(async () => "ok", {
			shell: () => shell,
		});
		expect(tool.description).not.toContain("PowerShell");

		shell = "powershell.exe";
		expect(tool.description).toContain("Commands run through PowerShell");

		// The property must survive the shallow copy the runtime performs when
		// building AgentToolDefinitions for a model request.
		shell = "cmd.exe";
		const definition = { ...tool };
		expect(definition.description).toContain("Commands run through cmd.exe");
	});
});

describe("default run_commands tool", () => {
	function createTelemetryStub(): ITelemetryService {
		return {
			capture: vi.fn(),
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateMetadata: vi.fn(),
			setCommonProperties: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: vi.fn(() => true),
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		};
	}

	function capturedTimeoutEvents(telemetry: ITelemetryService) {
		return (telemetry.capture as ReturnType<typeof vi.fn>).mock.calls
			.map((call) => call[0])
			.filter((event) => event.event === "sdk.tool_timeout");
	}

	it("reads telemetry from the internal metadata key", () => {
		const telemetry = createTelemetryStub();

		expect(
			getToolContextTelemetry({
				telemetry: "user-defined-label",
				[CLINE_INTERNAL_TELEMETRY_METADATA_KEY]: telemetry,
			}),
		).toBe(telemetry);
	});

	it("accepts object input with commands as a single string", async () => {
		const execute = vi.fn(async (command: string | { command: string }) =>
			typeof command === "string" ? `ran:${command}` : `ran:${command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute({ commands: "ls" } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		});

		expect(result).toEqual([
			{
				query: "ls",
				result: "ran:ls",
				success: true,
			},
		]);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith(
			"ls",
			process.cwd(),
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("accepts common single-command aliases", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		await tool.execute({ command: "pwd" } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		});
		await tool.execute({ cmd: "git status --short" } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 2,
		});

		expect(execute).toHaveBeenNthCalledWith(
			1,
			"pwd",
			process.cwd(),
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			"git status --short",
			process.cwd(),
			expect.objectContaining({ iteration: 2 }),
		);
	});

	it("accepts structured commands and preserves argv", async () => {
		const execute = vi.fn(
			async (command: string | { command: string; args?: string[] }) =>
				typeof command === "string"
					? `ran:${command}`
					: `ran:${command.command}:${(command.args ?? []).join(",")}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{
				commands: {
					command: "node",
					args: ["-e", "console.log('ok')"],
				},
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: "node -e console.log('ok')",
				result: "ran:node:-e,console.log('ok')",
				success: true,
			},
		]);
		expect(execute).toHaveBeenCalledWith(
			{
				command: "node",
				args: ["-e", "console.log('ok')"],
			},
			process.cwd(),
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("accepts mixed structured and string command arrays", async () => {
		const execute = vi.fn(
			async (command: string | { command: string; args?: string[] }) =>
				typeof command === "string"
					? `ran:${command}`
					: `ran:${command.command}:${(command.args ?? []).join(",")}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{
				commands: ["pwd", { command: "node", args: ["--version"] }],
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{ query: "pwd", result: "ran:pwd", success: true },
			{
				query: "node --version",
				result: "ran:node:--version",
				success: true,
			},
		]);
		expect(execute).toHaveBeenNthCalledWith(
			1,
			"pwd",
			process.cwd(),
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{ command: "node", args: ["--version"] },
			process.cwd(),
			expect.objectContaining({ iteration: 1 }),
		);
	});

	it("rejects invalid text-object command entries", async () => {
		const execute = vi.fn(async () => "ran");
		const tool = createShellTool(execute);

		await expect(
			tool.execute({ commands: [{ $text: "pwd" }] } as never, {
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		).rejects.toThrow("Invalid input");
		expect(execute).not.toHaveBeenCalled();
	});

	it("preserves args on direct structured command objects", async () => {
		const execute = vi.fn(
			async (command: string | { command: string; args?: string[] }) =>
				typeof command === "string"
					? `ran:${command}`
					: `ran:${command.command}:${(command.args ?? []).join(",")}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{ command: "git", args: ["status", "--short"] } as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: "git status --short",
				result: "ran:git:status,--short",
				success: true,
			},
		]);
		expect(execute).toHaveBeenCalledWith(
			{ command: "git", args: ["status", "--short"] },
			process.cwd(),
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("keeps short command echoes unchanged in tool results", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{ commands: ["git status --short"] },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: "git status --short",
				result: "ran:git status --short",
				success: true,
			},
		]);
	});

	it("returns captured output for non-zero command exits", async () => {
		const execute = vi.fn(async () => {
			throw new CommandExitError(
				1,
				"[Command exited with code 1]\nfailed assertion details",
			);
		});
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{ commands: ["bun test"] },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: "bun test",
				result: "[Command exited with code 1]\nfailed assertion details",
				error: "Command exited with code 1",
				success: false,
			},
		]);
	});

	it("coalesces split heredoc command arrays before execution", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{
				commands: [
					"cd /app && python3 << 'PYEOF'",
					"import csv",
					"print('ok')",
					"PYEOF",
				],
			},
			{
				sessionId: "session-split-heredoc",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		const expectedCommand =
			"cd /app && python3 << 'PYEOF'\nimport csv\nprint('ok')\nPYEOF";
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith(
			expectedCommand,
			process.cwd(),
			expect.objectContaining({ sessionId: "session-split-heredoc" }),
		);
		expect(result).toEqual([
			expect.objectContaining({
				query: expect.stringContaining("cd /app && python3"),
				result: `ran:${expectedCommand}`,
				success: true,
			}),
		]);
	});

	it("coalesces split heredocs while preserving surrounding command order", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{
				commands: [
					"pwd",
					"python3 << 'PYEOF'",
					"print('ok')",
					"PYEOF",
					"ls /app",
				],
			},
			{
				sessionId: "session-surrounding-heredoc",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		const expectedCommand = "python3 << 'PYEOF'\nprint('ok')\nPYEOF";
		expect(execute).toHaveBeenCalledTimes(3);
		expect(execute).toHaveBeenNthCalledWith(
			1,
			"pwd",
			process.cwd(),
			expect.objectContaining({ sessionId: "session-surrounding-heredoc" }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			expectedCommand,
			process.cwd(),
			expect.objectContaining({ sessionId: "session-surrounding-heredoc" }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			3,
			"ls /app",
			process.cwd(),
			expect.objectContaining({ sessionId: "session-surrounding-heredoc" }),
		);
		expect(result).toEqual([
			expect.objectContaining({ query: "pwd", result: "ran:pwd" }),
			expect.objectContaining({
				query: expectedCommand,
				result: `ran:${expectedCommand}`,
			}),
			expect.objectContaining({ query: "ls /app", result: "ran:ls /app" }),
		]);
	});

	it("coalesces split tab-stripping heredocs", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{
				commands: ["cat <<- EOF", "\tindented body", "EOF"],
			},
			{
				sessionId: "session-tab-stripping-heredoc",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		const expectedCommand = "cat <<- EOF\n\tindented body\nEOF";
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute).toHaveBeenCalledWith(
			expectedCommand,
			process.cwd(),
			expect.objectContaining({
				sessionId: "session-tab-stripping-heredoc",
			}),
		);
		expect(result).toEqual([
			expect.objectContaining({
				query: expectedCommand,
				result: `ran:${expectedCommand}`,
			}),
		]);
	});

	it("does not coalesce independent command arrays", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{ commands: ["pwd", "ls /app"] },
			{
				sessionId: "session-independent-commands",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(result).toEqual([
			expect.objectContaining({ query: "pwd", result: "ran:pwd" }),
			expect.objectContaining({ query: "ls /app", result: "ran:ls /app" }),
		]);
	});

	it("coalesces consecutive split heredoc command arrays independently", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{
				commands: [
					"cat << 'FOO'",
					"foo body",
					"FOO",
					"cat << 'BAR'",
					"bar body",
					"BAR",
				],
			},
			{
				sessionId: "session-consecutive-heredocs",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		const expectedFirstCommand = "cat << 'FOO'\nfoo body\nFOO";
		const expectedSecondCommand = "cat << 'BAR'\nbar body\nBAR";
		expect(execute).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenNthCalledWith(
			1,
			expectedFirstCommand,
			process.cwd(),
			expect.objectContaining({ sessionId: "session-consecutive-heredocs" }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			expectedSecondCommand,
			process.cwd(),
			expect.objectContaining({ sessionId: "session-consecutive-heredocs" }),
		);
		expect(result).toEqual([
			expect.objectContaining({
				query: "cat << 'FOO'\nfoo body\nFOO",
				result: `ran:${expectedFirstCommand}`,
			}),
			expect.objectContaining({
				query: "cat << 'BAR'\nbar body\nBAR",
				result: `ran:${expectedSecondCommand}`,
			}),
		]);
	});

	it("does not treat here-strings as split heredocs", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{ commands: ['wc -c <<< "hello"', "hello"] },
			{
				sessionId: "session-here-string",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(result).toEqual([
			expect.objectContaining({
				query: 'wc -c <<< "hello"',
				result: 'ran:wc -c <<< "hello"',
			}),
			expect.objectContaining({
				query: "hello",
				result: "ran:hello",
			}),
		]);
	});

	it("does not coalesce unterminated heredoc command arrays", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createShellTool(execute);

		const result = await tool.execute(
			{ commands: ["python3 << 'PYEOF'", "print('ok')"] },
			{
				sessionId: "session-unterminated-heredoc",
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(result).toEqual([
			expect.objectContaining({
				query: "python3 << 'PYEOF'",
				result: "ran:python3 << 'PYEOF'",
			}),
			expect.objectContaining({
				query: "print('ok')",
				result: "ran:print('ok')",
			}),
		]);
	});

	it("truncates long command echoes in tool results without affecting execution", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command.length : command.command.length}`,
		);
		const tool = createShellTool(execute);
		const largeSource = "x".repeat(14000);
		const command = `cat > /app/eval.scm << 'EOF'\n${largeSource}\nEOF`;

		const result = (await tool.execute(
			{ commands: [command] },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		)) as Array<{ query: string; result: string; success: boolean }>;

		// The executor still receives the full command
		expect(execute).toHaveBeenCalledWith(
			command,
			process.cwd(),
			expect.anything(),
		);
		expect(result[0].success).toBe(true);
		expect(result[0].result).toBe(`ran:${command.length}`);
		// The provider-facing echo is bounded and self-describing
		expect(result[0].query.length).toBeLessThan(
			RUN_COMMAND_QUERY_PREVIEW_LIMIT + 100,
		);
		expect(result[0].query).toContain("cat > /app/eval.scm << 'EOF'");
		expect(result[0].query).toContain("command truncated");
		expect(result[0].query).toContain("full command is in the tool call input");
	});

	it("truncates long command echoes on the error path too", async () => {
		const execute = vi.fn(async () => {
			throw new Error("boom");
		});
		const tool = createShellTool(execute);
		const command = `cat > /app/big.txt << 'EOF'\n${"y".repeat(10000)}\nEOF`;

		const result = (await tool.execute(
			{ commands: [command] },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		)) as Array<{ query: string; success: boolean; error?: string }>;

		expect(result[0].success).toBe(false);
		expect(result[0].error).toContain("boom");
		expect(result[0].query.length).toBeLessThan(
			RUN_COMMAND_QUERY_PREVIEW_LIMIT + 100,
		);
		expect(result[0].query).toContain("command truncated");
	});

	it("truncates long command echoes for the structured windows shell tool", async () => {
		const execute = vi.fn(async () => "ok");
		const tool = createShellTool(execute);
		const command = `powershell -Command "${"z".repeat(9000)}"`;

		const result = (await tool.execute({ commands: [command] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		})) as Array<{ query: string; success: boolean }>;

		expect(result[0].success).toBe(true);
		expect(result[0].query.length).toBeLessThan(
			RUN_COMMAND_QUERY_PREVIEW_LIMIT + 100,
		);
		expect(result[0].query).toContain("command truncated");
	});

	it("emits timeout telemetry without leaking raw command data", async () => {
		// Never resolves, so the configured timeout deterministically wins the
		// race regardless of host load (a tight real-timer margin flaked under
		// heavy parallel CI runs).
		const execute = vi.fn((): Promise<string> => new Promise<string>(() => {}));
		const tool = createShellTool(execute, { bashTimeoutMs: 5 });
		const telemetry = createTelemetryStub();

		const result = await tool.execute(
			{
				commands: [
					{
						command: process.execPath,
						args: ["-e", "console.log('secret-token')"],
					},
					"pwd",
				],
			} as never,
			{
				sessionId: "session-1",
				agentId: "agent-1",
				conversationId: "conv-1",
				runId: "run-1",
				iteration: 1,
				toolCallId: "tool-call-1",
				metadata: {
					[CLINE_INTERNAL_TELEMETRY_METADATA_KEY]: telemetry,
					mode: "act",
					source: "sdk-test",
				},
			},
		);

		expect(result).toEqual([
			expect.objectContaining({ success: false }),
			expect.objectContaining({ success: false }),
		]);
		const timeoutCalls = capturedTimeoutEvents(telemetry);
		expect(timeoutCalls).toHaveLength(2);
		for (const call of timeoutCalls) {
			expect(call.properties).toMatchObject({
				tool_name: "run_commands",
				effective_timeout_ms: 5,
				timeout_source: "configured_setting",
				command_count: 2,
				ulid: "session-1",
				mode: "act",
				source: "sdk-test",
				session_id: "session-1",
				agent_id: "agent-1",
				conversation_id: "conv-1",
				run_id: "run-1",
				iteration: 1,
				tool_call_id: "tool-call-1",
			});
			expect(typeof call.properties.duration_ms).toBe("number");
			const payload = JSON.stringify(call.properties);
			expect(payload).not.toContain("secret-token");
			expect(payload).not.toContain("pwd");
			expect(payload).not.toContain("stdout");
			expect(payload).not.toContain("stderr");
			expect(payload).not.toContain("env");
			expect(call.properties).not.toHaveProperty("command");
			expect(call.properties).not.toHaveProperty("commands");
		}
	});

	it("emits timeout telemetry for executor TimeoutError only", async () => {
		const telemetry = createTelemetryStub();
		const executorTimeout = vi.fn(async () => {
			throw new TimeoutError("Command timed out after 5000ms", 5000);
		});
		const plainFailure = vi.fn(async () => {
			throw new Error("Command timed out after 5000ms");
		});

		await createShellTool(executorTimeout, {
			bashTimeoutMs: 5000,
		}).execute({ commands: ["echo timeout"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
			metadata: { [CLINE_INTERNAL_TELEMETRY_METADATA_KEY]: telemetry },
		});
		await createShellTool(plainFailure, { bashTimeoutMs: 5000 }).execute(
			{ commands: ["echo not-timeout"] } as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
				metadata: { [CLINE_INTERNAL_TELEMETRY_METADATA_KEY]: telemetry },
			},
		);

		const timeoutCalls = capturedTimeoutEvents(telemetry);
		expect(timeoutCalls).toHaveLength(1);
		expect(timeoutCalls[0]?.properties).toMatchObject({
			effective_timeout_ms: 5000,
			timeout_source: "configured_setting",
			command_count: 1,
		});
	});

	it("emits timeout telemetry on the default bash tool path", async () => {
		const telemetry = createTelemetryStub();
		// Never resolves, so the configured timeout deterministically wins the
		// race regardless of host load (a tight real-timer margin flaked under
		// heavy parallel CI runs).
		const execute = vi.fn((): Promise<string> => new Promise<string>(() => {}));
		const tool = createShellTool(execute, { bashTimeoutMs: 5 });

		const result = await tool.execute(
			{ commands: ["echo secret-token", "pwd"] },
			{
				sessionId: "session-1",
				agentId: "agent-1",
				conversationId: "conv-1",
				runId: "run-1",
				iteration: 1,
				toolCallId: "tool-call-1",
				metadata: {
					[CLINE_INTERNAL_TELEMETRY_METADATA_KEY]: telemetry,
					mode: "act",
					source: "sdk-test",
				},
			},
		);

		expect(result).toEqual([
			expect.objectContaining({ success: false }),
			expect.objectContaining({ success: false }),
		]);
		const timeoutCalls = capturedTimeoutEvents(telemetry);
		expect(timeoutCalls).toHaveLength(2);
		for (const call of timeoutCalls) {
			expect(call.properties).toMatchObject({
				tool_name: "run_commands",
				effective_timeout_ms: 5,
				timeout_source: "configured_setting",
				command_count: 2,
				ulid: "session-1",
				mode: "act",
				source: "sdk-test",
				session_id: "session-1",
				agent_id: "agent-1",
				conversation_id: "conv-1",
				run_id: "run-1",
				iteration: 1,
				tool_call_id: "tool-call-1",
			});
			expect(typeof call.properties.duration_ms).toBe("number");
			const payload = JSON.stringify(call.properties);
			expect(payload).not.toContain("secret-token");
			expect(payload).not.toContain("pwd");
			expect(call.properties).not.toHaveProperty("command");
			expect(call.properties).not.toHaveProperty("commands");
		}
	});

	it("does not emit timeout telemetry for normal command success", async () => {
		const execute = vi.fn(async () => "ok");
		const tool = createShellTool(execute, { bashTimeoutMs: 50 });
		const telemetry = createTelemetryStub();

		await tool.execute({ commands: ["echo hi"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
			metadata: { [CLINE_INTERNAL_TELEMETRY_METADATA_KEY]: telemetry },
		});

		expect(capturedTimeoutEvents(telemetry)).toEqual([]);
	});
});

describe("default read_files tool", () => {
	it("validates ranged file requests and passes them to the executor", async () => {
		const execute = vi.fn(async () => "selected lines");
		const tool = createReadFilesTool(execute);

		const result = await tool.execute(
			{
				files: [
					{
						path: "/tmp/example.ts",
						start_line: 3,
						end_line: 5,
					},
				],
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: '{"path":"/tmp/example.ts","start_line":3,"end_line":5}',
				result: "selected lines",
				success: true,
			},
		]);
		expect(execute).toHaveBeenCalledWith(
			{
				path: "/tmp/example.ts",
				start_line: 3,
				end_line: 5,
			},
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("accepts string union inputs reading full file content", async () => {
		const execute = vi.fn(async () => "full file");
		const tool = createReadFilesTool(execute);

		await tool.execute("/tmp/example.ts" as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		});

		expect(execute).toHaveBeenCalledWith(
			{ path: "/tmp/example.ts" },
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("accepts paths aliases for model-generated read requests", async () => {
		const execute = vi.fn(
			async (request: { path: string }) => `content:${request.path}`,
		);
		const tool = createReadFilesTool(execute);

		await tool.execute(
			{
				paths: ["/tmp/a.ts", { path: "/tmp/b.ts", start_line: 2 }],
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		await tool.execute({ paths: "/tmp/c.ts" } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 2,
		});

		expect(execute).toHaveBeenNthCalledWith(
			1,
			{ path: "/tmp/a.ts" },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{ path: "/tmp/b.ts", start_line: 2 },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			3,
			{ path: "/tmp/c.ts" },
			expect.objectContaining({ iteration: 2 }),
		);
	});

	it("accepts files aliases with string paths from model-generated read requests", async () => {
		const execute = vi.fn(
			async (request: { path: string }) => `content:${request.path}`,
		);
		const tool = createReadFilesTool(execute);

		await tool.execute(
			{ files: ["/tmp/a.ts", { path: "/tmp/b.ts", end_line: 4 }] } as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		await tool.execute({ files: "/tmp/c.ts" } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 2,
		});

		expect(execute).toHaveBeenNthCalledWith(
			1,
			{ path: "/tmp/a.ts" },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{ path: "/tmp/b.ts", end_line: 4 },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			3,
			{ path: "/tmp/c.ts" },
			expect.objectContaining({ iteration: 2 }),
		);
	});

	it("accepts filePath/file_path aliases and echoes canonical keys in results", async () => {
		const execute = vi.fn(
			async (request: { path: string }) => `content:${request.path}`,
		);
		const tool = createReadFilesTool(execute);

		// The exact drift observed in the wild: camelCase key on each entry.
		const camelResult = await tool.execute(
			{
				files: [
					{ filePath: "/tmp/client.go", start_line: 1, end_line: 200 },
					{ filePath: "/tmp/service.go" },
				],
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		const snakeResult = await tool.execute(
			{ files: [{ file_path: "/tmp/queries.go", start_line: 2 }] } as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
			},
		);

		expect(execute).toHaveBeenNthCalledWith(
			1,
			{ path: "/tmp/client.go", start_line: 1, end_line: 200 },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{ path: "/tmp/service.go" },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			3,
			{ path: "/tmp/queries.go", start_line: 2 },
			expect.objectContaining({ iteration: 2 }),
		);
		expect(camelResult).toEqual([
			{
				query: '{"path":"/tmp/client.go","start_line":1,"end_line":200}',
				result: "content:/tmp/client.go",
				success: true,
			},
			{
				query: '{"path":"/tmp/service.go"}',
				result: "content:/tmp/service.go",
				success: true,
			},
		]);
		expect(snakeResult).toEqual([
			{
				query: '{"path":"/tmp/queries.go","start_line":2}',
				result: "content:/tmp/queries.go",
				success: true,
			},
		]);
	});

	it("accepts path-key aliases on bare and paths-keyed entries", async () => {
		const execute = vi.fn(
			async (request: { path: string }) => `content:${request.path}`,
		);
		const tool = createReadFilesTool(execute);

		await tool.execute({ filePath: "/tmp/bare.ts", end_line: 9 } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		});
		await tool.execute(
			{ paths: [{ file_path: "/tmp/listed.ts" }, "/tmp/plain.ts"] } as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
			},
		);

		expect(execute).toHaveBeenNthCalledWith(
			1,
			{ path: "/tmp/bare.ts", end_line: 9 },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{ path: "/tmp/listed.ts" },
			expect.objectContaining({ iteration: 2 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			3,
			{ path: "/tmp/plain.ts" },
			expect.objectContaining({ iteration: 2 }),
		);
	});

	it("folds orphan range entries into the preceding file entry", async () => {
		const execute = vi.fn(
			async (request: { path: string }) => `content:${request.path}`,
		);
		const tool = createReadFilesTool(execute);

		await tool.execute(
			{
				files: [
					{ path: "/tmp/example.ips" },
					{ start_line: 45, end_line: 100 },
				],
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		await tool.execute(
			{ paths: ["/tmp/a.ts", { end_line: 4 }, "/tmp/b.ts"] } as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
			},
		);
		await tool.execute(
			{
				files: [
					{ filePath: "/tmp/aliased.ts" },
					{ start_line: 3, end_line: 7 },
				],
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 3,
			},
		);

		expect(execute).toHaveBeenNthCalledWith(
			1,
			{ path: "/tmp/example.ips", start_line: 45, end_line: 100 },
			expect.objectContaining({ iteration: 1 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{ path: "/tmp/a.ts", end_line: 4 },
			expect.objectContaining({ iteration: 2 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			3,
			{ path: "/tmp/b.ts" },
			expect.objectContaining({ iteration: 2 }),
		);
		expect(execute).toHaveBeenNthCalledWith(
			4,
			{ path: "/tmp/aliased.ts", start_line: 3, end_line: 7 },
			expect.objectContaining({ iteration: 3 }),
		);
	});

	it("rejects orphan range entries that cannot be attached to a file entry", async () => {
		const execute = vi.fn(async () => "should not run");
		const tool = createReadFilesTool(execute);

		// Leading orphan range: no preceding file entry to fold into.
		await expect(
			tool.execute(
				{
					files: [{ start_line: 1, end_line: 2 }, { path: "/tmp/a.ts" }],
				} as never,
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow();

		// Preceding entry already has its own range: keep the conflict visible.
		await expect(
			tool.execute(
				{
					files: [
						{ path: "/tmp/a.ts", start_line: 1 },
						{ start_line: 4, end_line: 8 },
					],
				} as never,
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 2,
				},
			),
		).rejects.toThrow();

		expect(execute).not.toHaveBeenCalled();
	});

	it("rejects invalid union inputs with a canonical-shape hint before calling the executor", async () => {
		const execute = vi.fn(async () => "should not run");
		const tool = createReadFilesTool(execute);

		await expect(
			tool.execute({ paths: ["/tmp/a.ts", 42] } as never, {
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		).rejects.toThrow(
			/Expected input like: \{"files": \[\{"path": "\/absolute\/path\/to\/file\.ts", "start_line": 1, "end_line": 100\}\]\}/,
		);

		expect(execute).not.toHaveBeenCalled();
	});

	it("treats null line bounds as full-file boundaries", async () => {
		const execute = vi.fn(async () => "full file");
		const tool = createReadFilesTool(execute);

		const result = await tool.execute(
			{
				files: [
					{
						path: "/tmp/example.ts",
						start_line: null,
						end_line: null,
					},
				],
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: '{"path":"/tmp/example.ts"}',
				result: "full file",
				success: true,
			},
		]);
		expect(execute).toHaveBeenCalledWith(
			{
				path: "/tmp/example.ts",
				start_line: null,
				end_line: null,
			},
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("returns per-file errors for reversed ranges while executing valid batch entries", async () => {
		const execute = vi.fn(async (request: { path: string }) => {
			return `content for ${request.path}`;
		});
		const tool = createReadFilesTool(execute);

		const result = await tool.execute(
			{
				files: [
					{
						path: "/tmp/valid-a.ts",
						start_line: 1,
						end_line: 2,
					},
					{
						path: "/tmp/reversed.ts",
						start_line: 5,
						end_line: 3,
					},
					{
						path: "/tmp/valid-b.ts",
					},
				],
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual([
			{
				query: '{"path":"/tmp/valid-a.ts","start_line":1,"end_line":2}',
				result: "content for /tmp/valid-a.ts",
				success: true,
			},
			{
				query: '{"path":"/tmp/reversed.ts","start_line":5,"end_line":3}',
				result: "",
				error:
					"Invalid file range: start_line must be less than or equal to end_line (received start_line: 5, end_line: 3)",
				success: false,
			},
			{
				query: '{"path":"/tmp/valid-b.ts"}',
				result: "content for /tmp/valid-b.ts",
				success: true,
			},
		]);
		expect(execute).toHaveBeenCalledTimes(2);
		expect(execute).toHaveBeenNthCalledWith(
			1,
			{
				path: "/tmp/valid-a.ts",
				start_line: 1,
				end_line: 2,
			},
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{
				path: "/tmp/valid-b.ts",
			},
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});
});

describe("zod schema conversion", () => {
	it("advertises run_commands as string-only command arrays", () => {
		const tool = createShellTool(async () => "ok");
		const inputSchema = tool.inputSchema as Record<string, unknown>;
		const serialized = JSON.stringify(inputSchema);

		expect(serialized).not.toContain('"anyOf"');
		expect(serialized).not.toContain("Prefer structured");
		expect(hasSchemaKey(inputSchema, "command")).toBe(false);

		const properties = inputSchema.properties as Record<string, unknown>;
		const commands = properties.commands as {
			items?: { type?: string };
		};
		expect(commands.items?.type).toBe("string");
	});

	it("preserves read_files required properties in generated JSON schema", () => {
		const tool = createReadFilesTool(async () => "ok");
		const inputSchema = tool.inputSchema as Record<string, unknown>;
		const properties = inputSchema.properties as Record<string, unknown>;
		expect(inputSchema.type).toBe("object");
		expect(properties.files).toMatchObject({
			type: "array",
			items: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description:
							"The absolute path of a text file to read content from",
					},
					start_line: {
						anyOf: [{ type: "integer" }, { type: "null" }],
						description:
							"Optional one-based starting line number to read from; use null or omit for the start of the file",
					},
					end_line: {
						anyOf: [{ type: "integer" }, { type: "null" }],
						description:
							"Optional one-based ending line number to read through; use null or omit to read to the end of the file or the read cap, whichever comes first",
					},
				},
				required: ["path"],
			},
			description:
				"Array of file read requests; each element is one file and must include path. Omit start_line/end_line or set them to null to read from the start; provide integers on the same object as the path to return only that inclusive one-based line range — never emit a range as its own array element. Reads are capped, so page through long files with start_line/end_line. Prefer this tool over running terminal command to get file content for better performance and reliability.",
		});
		expect(inputSchema.required).toEqual(["files"]);
	});

	it("exposes skills args as optional nullable in tool schemas", () => {
		const tools = createDefaultTools({
			executors: {
				skills: createMockSkillsExecutor(),
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableEditor: false,
			enableApplyPatch: false,
			enableAskQuestion: false,
			enableSkills: true,
		});
		const skills = tools.find((tool) => tool.name === "skills");
		expect(skills).toBeDefined();
		if (!skills) {
			throw new Error("Expected skills tool.");
		}
		const schema = skills.inputSchema as {
			required?: string[];
			properties?: Record<string, unknown>;
		};
		expect(schema.required).toEqual(["skill"]);
		expect(schema.properties).toHaveProperty("args");
	});
});

describe("default editor tool", () => {
	it("accepts replacement edits without insert fields", async () => {
		const execute = vi.fn(async () => "patched");
		const tools = createDefaultTools({
			executors: {
				editor: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableSkills: false,
			enableAskQuestion: false,
			enableApplyPatch: false,
			enableEditor: true,
		});
		const editorTool = tools.find((tool) => tool.name === "editor");
		expect(editorTool).toBeDefined();
		if (!editorTool) {
			throw new Error("Expected editor tool to be defined.");
		}

		const result = await editorTool.execute(
			{
				path: "/tmp/example.ts",
				old_text: "before",
				new_text: "after",
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual({
			query: "edit:/tmp/example.ts",
			result: "patched",
			success: true,
		});
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				path: "/tmp/example.ts",
				old_text: "before",
				new_text: "after",
			}),
			process.cwd(),
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});

	it("allows edit without old_text so missing files can be created", async () => {
		const execute = vi.fn(async () => "patched");
		const tools = createDefaultTools({
			executors: {
				editor: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableSkills: false,
			enableAskQuestion: false,
			enableApplyPatch: false,
			enableEditor: true,
		});
		const editorTool = tools.find((tool) => tool.name === "editor");
		expect(editorTool).toBeDefined();
		if (!editorTool) {
			throw new Error("Expected editor tool to be defined.");
		}

		const result = await editorTool.execute(
			{
				path: "/tmp/example.ts",
				new_text: "created",
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual({
			query: "edit:/tmp/example.ts",
			result: "patched",
			success: true,
		});
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				path: "/tmp/example.ts",
				new_text: "created",
			}),
			process.cwd(),
			expect.anything(),
		);
	});

	it("treats insert_line as an insert operation", async () => {
		const execute = vi.fn(async () => "patched");
		const tools = createDefaultTools({
			executors: {
				editor: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableSkills: false,
			enableAskQuestion: false,
			enableApplyPatch: false,
			enableEditor: true,
		});
		const editorTool = tools.find((tool) => tool.name === "editor");
		expect(editorTool).toBeDefined();
		if (!editorTool) {
			throw new Error("Expected editor tool to be defined.");
		}

		const result = await editorTool.execute(
			{
				path: "/tmp/example.ts",
				new_text: "after",
				insert_line: 3,
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual({
			query: "insert:/tmp/example.ts",
			result: "patched",
			success: true,
		});
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				path: "/tmp/example.ts",
				new_text: "after",
				insert_line: 3,
			}),
			process.cwd(),
			expect.anything(),
		);
	});

	it("returns a recoverable tool error when text exceeds the soft character limit", async () => {
		const execute = vi.fn(async () => "patched");
		const tools = createDefaultTools({
			executors: {
				editor: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableSkills: false,
			enableAskQuestion: false,
			enableApplyPatch: false,
			enableEditor: true,
		});
		const editorTool = tools.find((tool) => tool.name === "editor");
		expect(editorTool).toBeDefined();
		if (!editorTool) {
			throw new Error("Expected editor tool to be defined.");
		}

		const oversizedText = "x".repeat(INPUT_ARG_CHAR_LIMIT + 1);
		const result = await editorTool.execute(
			{
				path: "/tmp/example.ts",
				new_text: oversizedText,
			},
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toEqual({
			query: "edit:/tmp/example.ts",
			result: "",
			error: expect.stringContaining("new_text was"),
			success: false,
		});
		if (typeof result !== "object" || result == null || !("error" in result)) {
			throw new Error("Expected editor tool result to include an error.");
		}
		expect(result.error).toContain(
			`recommended limit of ${INPUT_ARG_CHAR_LIMIT}`,
		);
		expect(execute).not.toHaveBeenCalled();
	});
});
