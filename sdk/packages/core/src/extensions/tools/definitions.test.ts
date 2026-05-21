import { describe, expect, it, vi } from "vitest";
import type { ITelemetryService } from "@cline/shared";
import {
	createBashTool,
	createBuiltinTools,
	createDefaultTools,
	createReadFilesTool,
	createSkillsTool,
	createWindowsShellTool,
} from ".";
import { MAX_RUN_COMMANDS_TIMEOUT_MS } from "./constants";
import { TimeoutError, withTimeout } from "./helpers";
import {
	INPUT_ARG_CHAR_LIMIT,
	RunCommandsInputSchema,
	RunCommandsInputUnionSchema,
	StructuredCommandsInputSchema,
	StructuredCommandsInputUnionSchema,
} from "./schemas";
import type { SkillsExecutorWithMetadata } from "./types";

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

describe("default run_commands tool", () => {
	function createTelemetryStub(): ITelemetryService {
		return {
			capture: vi.fn(),
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			updateCommonProperties: vi.fn(),
			identify: vi.fn(),
		} as unknown as ITelemetryService;
	}

	it("clears wrapper timers after fast commands resolve", async () => {
		vi.useFakeTimers();
		try {
			await withTimeout(
				Promise.resolve("ok"),
				MAX_RUN_COMMANDS_TIMEOUT_MS,
				"slow",
			);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("uses executorOptions bash timeout as the built-in tool wrapper default", async () => {
		const execute = vi.fn(async () => "ran");
		const tools = createBuiltinTools({
			enableReadFiles: false,
			enableSearch: false,
			enableBash: true,
			enableWebFetch: false,
			enableEditor: false,
			enableSkills: false,
			enableAskQuestion: false,
			executorOptions: {
				bash: { timeoutMs: 60000 },
			},
			executors: {
				bash: execute,
			},
		});
		const tool = tools.find((candidate) => candidate.name === "run_commands");
		expect(tool).toBeDefined();
		if (!tool) {
			throw new Error("Expected run_commands tool.");
		}

		await tool.execute({ commands: ["echo hi"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		});

		expect(execute).toHaveBeenCalledWith(
			"echo hi",
			process.cwd(),
			expect.objectContaining({ agentId: "agent-1" }),
			60000,
		);
	});

	it("accepts per-command timeout in structured command payloads", () => {
		expect(
			RunCommandsInputSchema.parse({
				commands: [{ command: "echo hi", timeout: 120000 }],
			}),
		).toEqual({ commands: [{ command: "echo hi", timeout: 120000 }] });

		expect(
			StructuredCommandsInputSchema.parse({
				commands: [{ command: "echo hi", timeout: null }],
			}),
		).toEqual({ commands: [{ command: "echo hi", timeout: null }] });
	});

	it("advertises per-command timeout as milliseconds or null", () => {
		const tool = createWindowsShellTool(vi.fn(async () => "ok"));
		const schema = tool.inputSchema as {
			properties?: {
				timeout?: unknown;
				commands?: {
					items?: {
						anyOf?: Array<{
							type?: string;
							properties?: {
								timeout?: {
									anyOf?: Array<Record<string, unknown>>;
								};
							};
						}>;
					};
				};
			};
		};
		const structuredCommandSchema =
			schema.properties?.commands?.items?.anyOf?.find(
				(candidate) => candidate.type === "object",
			);
		const timeoutSchema =
			structuredCommandSchema?.properties?.timeout?.anyOf ?? [];

		expect(schema.properties?.timeout).toBeUndefined();
		expect(timeoutSchema).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "integer",
					minimum: 1000,
					maximum: MAX_RUN_COMMANDS_TIMEOUT_MS,
				}),
				expect.objectContaining({ type: "null" }),
			]),
		);
	});

	it("preserves legacy run_commands payload forms while allowing per-command timeout", () => {
		expect(
			RunCommandsInputUnionSchema.parse({ commands: ["echo hi"] }),
		).toEqual({
			commands: ["echo hi"],
		});
		expect(RunCommandsInputUnionSchema.parse({ commands: "echo hi" })).toEqual({
			commands: "echo hi",
		});
		expect(RunCommandsInputUnionSchema.parse({ command: "echo hi" })).toEqual({
			command: "echo hi",
		});
		expect(RunCommandsInputUnionSchema.parse({ cmd: "echo hi" })).toEqual({
			cmd: "echo hi",
		});
		expect(RunCommandsInputUnionSchema.parse(["echo hi"])).toEqual(["echo hi"]);
		expect(RunCommandsInputUnionSchema.parse("echo hi")).toBe("echo hi");
		expect(
			RunCommandsInputUnionSchema.parse({
				commands: [{ command: "echo hi", timeout: 120000 }],
			}),
		).toEqual({ commands: [{ command: "echo hi", timeout: 120000 }] });
	});

	it("rejects invalid timeout values with useful validation errors", () => {
		expect(() =>
			RunCommandsInputUnionSchema.parse({
				commands: [{ command: "echo hi", timeout: 0 }],
			}),
		).toThrow(/greater than or equal|too_small|1000/i);
		expect(() =>
			RunCommandsInputUnionSchema.parse({
				commands: [{ command: "echo hi", timeout: -1 }],
			}),
		).toThrow(/greater than or equal|too_small|1000/i);
		expect(() =>
			RunCommandsInputUnionSchema.parse({
				commands: [{ command: "echo hi", timeout: 12.5 }],
			}),
		).toThrow(/integer|int/i);
		expect(() =>
			RunCommandsInputUnionSchema.parse({
				commands: [{ command: "echo hi", timeout: "120000" }],
			}),
		).toThrow(/number/i);
		expect(() =>
			RunCommandsInputUnionSchema.parse({
				commands: [
					{ command: "echo hi", timeout: MAX_RUN_COMMANDS_TIMEOUT_MS + 1 },
				],
			}),
		).toThrow(/less than or equal|too_big|3600000/i);
		expect(() =>
			StructuredCommandsInputUnionSchema.parse({
				command: "echo hi",
				timeout: -1,
			}),
		).toThrow(/greater than or equal|too_small|1000/i);
		expect(
			StructuredCommandsInputUnionSchema.safeParse({
				commands: [{ command: "echo", timeout: 120000 }],
			}).success,
		).toBe(true);
		expect(
			StructuredCommandsInputUnionSchema.safeParse([
				{ command: "echo", timeout: 120000 },
			]).success,
		).toBe(true);
		expect(
			StructuredCommandsInputUnionSchema.safeParse({
				commands: [{ command: "echo", args: ["hi"], cwd: "/tmp" }],
			}).success,
		).toBe(true);
		expect(
			StructuredCommandsInputUnionSchema.parse({
				command: "echo",
				args: ["hi"],
				timeout: 120000,
				cwd: "/tmp",
			}),
		).toEqual({
			command: "echo",
			args: ["hi"],
			timeout: 120000,
			cwd: "/tmp",
		});
	});

	it("rejects top-level timeout with a self-correcting error", async () => {
		const execute = vi.fn(async () => "ran");
		const tool = createBashTool(execute);

		await expect(
			tool.execute({ commands: ["echo hi"], timeout: 120000 } as never, {
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		).rejects.toThrow(/Top-level timeout is not supported/);
		expect(execute).not.toHaveBeenCalled();
	});

	it("accepts object input with commands as a single string", async () => {
		const execute = vi.fn(async (command: string | { command: string }) =>
			typeof command === "string" ? `ran:${command}` : `ran:${command.command}`,
		);
		const tool = createWindowsShellTool(execute);

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
			30000,
		);
	});

	it("accepts common single-command aliases", async () => {
		const execute = vi.fn(
			async (command: string | { command: string }) =>
				`ran:${typeof command === "string" ? command : command.command}`,
		);
		const tool = createWindowsShellTool(execute);

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
			{ command: "pwd" },
			process.cwd(),
			expect.objectContaining({ iteration: 1 }),
			30000,
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			"git status --short",
			process.cwd(),
			expect.objectContaining({ iteration: 2 }),
			30000,
		);
	});

	it("accepts structured commands and preserves argv", async () => {
		const execute = vi.fn(
			async (command: string | { command: string; args?: string[] }) =>
				typeof command === "string"
					? `ran:${command}`
					: `ran:${command.command}:${(command.args ?? []).join(",")}`,
		);
		const tool = createWindowsShellTool(execute);

		const result = await tool.execute(
			{
				commands: {
					command: "node",
					args: ["-e", "console.log('ok')"],
					cwd: "/tmp",
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
			30000,
		);
	});

	it("preserves args on direct structured command objects", async () => {
		const execute = vi.fn(
			async (command: string | { command: string; args?: string[] }) =>
				typeof command === "string"
					? `ran:${command}`
					: `ran:${command.command}:${(command.args ?? []).join(",")}`,
		);
		const tool = createWindowsShellTool(execute);

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
			30000,
		);
	});

	it("uses configured timeout by default and lets per-command timeout override it", async () => {
		const execute = vi.fn(async (command: string | { command: string }) =>
			typeof command === "string" ? `ran:${command}` : `ran:${command.command}`,
		);
		const tool = createWindowsShellTool(execute, { bashTimeoutMs: 45000 });

		await tool.execute(
			{
				commands: [
					"echo default",
					{ command: "echo", args: ["override"], timeout: 120000 },
					{ command: "echo", args: ["nullable"], timeout: null },
				],
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(execute).toHaveBeenNthCalledWith(
			1,
			"echo default",
			process.cwd(),
			expect.objectContaining({ iteration: 1 }),
			45000,
		);
		expect(execute).toHaveBeenNthCalledWith(
			2,
			{ command: "echo", args: ["override"] },
			process.cwd(),
			expect.objectContaining({ iteration: 1 }),
			120000,
		);
		expect(execute).toHaveBeenNthCalledWith(
			3,
			{ command: "echo", args: ["nullable"] },
			process.cwd(),
			expect.objectContaining({ iteration: 1 }),
			45000,
		);
	});

	it("validates Windows shell per-command timeout before execution", async () => {
		const execute = vi.fn(async () => "ran");
		const tool = createWindowsShellTool(execute);

		await expect(
			tool.execute(
				{
					commands: [{ command: "echo invalid", timeout: 1.5 }],
				} as never,
				{
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow(/invalid input/i);
		expect(execute).not.toHaveBeenCalled();
	});

	it("reports the per-command timeout when a command times out", async () => {
		const execute = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			return "done";
		});
		const tool = createBashTool(execute, { bashTimeoutMs: 10 });

		const result = await tool.execute({ commands: ["echo slow"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
		});

		expect(result).toEqual([
			{
				query: "echo slow",
				result: "",
				error: "Command failed: Command timed out after 10ms",
				success: false,
			},
		]);
	});

	it("sets the outer tool timeout high enough to avoid killing larger per-command overrides early", () => {
		const tool = createWindowsShellTool(
			vi.fn(async () => "ok"),
			{
				bashTimeoutMs: 30000,
			},
		);

		expect(tool.timeoutMs).toBe(MAX_RUN_COMMANDS_TIMEOUT_MS);
	});

	it("emits timeout telemetry per timed-out command without leaking raw command data", async () => {
		const execute = vi.fn(
			async (
				_command: unknown,
				_cwd: string,
				_context: unknown,
				timeoutMs?: number,
			): Promise<string> => {
				throw new TimeoutError(`Command timed out after ${timeoutMs}ms`);
			},
		);
		const tool = createWindowsShellTool(execute, { bashTimeoutMs: 5 });
		const telemetry = createTelemetryStub();

		await tool.execute(
			{
				commands: [
					{ command: "echo", args: ["secret-token"], timeout: 120000 },
					"pwd",
				],
			} as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				runId: "run-1",
				iteration: 1,
				toolCallId: "tool-call-1",
				metadata: {
					telemetry,
					mode: "act",
					source: "sdk-test",
				},
			},
		);

		expect(telemetry.capture).toHaveBeenCalled();
		const timeoutCalls = (
			telemetry.capture as ReturnType<typeof vi.fn>
		).mock.calls
			.map((call) => call[0])
			.filter((event) => event.event === "sdk.tool_timeout");
		expect(timeoutCalls).toHaveLength(2);
		expect(timeoutCalls[0].properties).toMatchObject({
			tool_name: "run_commands",
			effective_timeout_ms: 120000,
			timeout_source: "command_parameter",
			command_count: 2,
			mode: "act",
			source: "sdk-test",
		});
		expect(timeoutCalls[1].properties).toMatchObject({
			tool_name: "run_commands",
			effective_timeout_ms: 5,
			timeout_source: "default_setting",
			command_count: 2,
			mode: "act",
			source: "sdk-test",
		});
		for (const call of timeoutCalls) {
			const payload = JSON.stringify(call.properties);
			expect(payload).not.toContain("echo secret-token");
			expect(payload).not.toContain("pwd");
			expect(payload).not.toContain("stdout");
			expect(payload).not.toContain("stderr");
			expect(payload).not.toContain("env");
			expect(call.properties).not.toHaveProperty("timeout_origin");
		}
	});

	it("emits timeout telemetry for default-setting timeouts", async () => {
		const execute = vi.fn(
			async (): Promise<string> =>
				await new Promise((resolve) => setTimeout(() => resolve("ok"), 20)),
		);
		const tool = createWindowsShellTool(execute, { bashTimeoutMs: 5 });
		const telemetry = createTelemetryStub();

		await tool.execute({ commands: ["echo slow"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
			metadata: { telemetry },
		});

		const timeoutCalls = (
			telemetry.capture as ReturnType<typeof vi.fn>
		).mock.calls
			.map((call) => call[0])
			.filter((event) => event.event === "sdk.tool_timeout");
		expect(timeoutCalls).toHaveLength(1);
		expect(timeoutCalls[0]?.properties).toMatchObject({
			effective_timeout_ms: 5,
			timeout_source: "default_setting",
		});
		expect(timeoutCalls[0]?.properties).not.toHaveProperty("timeout_origin");
	});

	it("emits timeout telemetry for TimeoutError without matching plain error text", async () => {
		const executorTimeout = vi.fn(async () => {
			throw new TimeoutError("Command timed out after 5000ms");
		});
		const plainFailure = vi.fn(async () => {
			throw new Error("Command timed out after 5000ms");
		});
		const telemetry = createTelemetryStub();

		await createWindowsShellTool(executorTimeout, {
			bashTimeoutMs: 5000,
		}).execute({ commands: ["echo timeout"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
			metadata: { telemetry },
		});
		await createWindowsShellTool(plainFailure, { bashTimeoutMs: 5000 }).execute(
			{ commands: ["echo not-timeout"] } as never,
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 2,
				metadata: { telemetry },
			},
		);

		const timeoutCalls = (
			telemetry.capture as ReturnType<typeof vi.fn>
		).mock.calls
			.map((call) => call[0])
			.filter((event) => event.event === "sdk.tool_timeout");
		expect(timeoutCalls).toHaveLength(1);
		expect(timeoutCalls[0]?.properties).toMatchObject({
			effective_timeout_ms: 5000,
			timeout_source: "default_setting",
		});
		expect(timeoutCalls[0]?.properties).not.toHaveProperty("timeout_origin");
	});

	it("does not emit timeout telemetry for normal command success", async () => {
		const execute = vi.fn(async () => "ok");
		const tool = createWindowsShellTool(execute, { bashTimeoutMs: 50 });
		const telemetry = createTelemetryStub();

		await tool.execute({ commands: ["echo hi"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
			metadata: { telemetry },
		});

		expect(
			(telemetry.capture as ReturnType<typeof vi.fn>).mock.calls
				.map((call) => call[0])
				.filter((event) => event.event === "sdk.tool_timeout"),
		).toEqual([]);
	});

	it("does not emit timeout telemetry for normal non-timeout failures", async () => {
		const execute = vi.fn(async () => {
			throw new Error("exit code 1");
		});
		const tool = createWindowsShellTool(execute, { bashTimeoutMs: 50 });
		const telemetry = createTelemetryStub();

		await tool.execute({ commands: ["false"] } as never, {
			agentId: "agent-1",
			conversationId: "conv-1",
			iteration: 1,
			metadata: { telemetry },
		});

		expect(
			(telemetry.capture as ReturnType<typeof vi.fn>).mock.calls
				.map((call) => call[0])
				.filter((event) => event.event === "sdk.tool_timeout"),
		).toEqual([]);
	});
});

describe("default read_files tool", () => {
	it("normalizes ranged file requests and passes them to the executor", async () => {
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
				query: "/tmp/example.ts:3-5",
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

	it("keeps legacy string inputs reading full file content", async () => {
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
				query: "/tmp/example.ts",
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
				query: "/tmp/valid-a.ts:1-2",
				result: "content for /tmp/valid-a.ts",
				success: true,
			},
			{
				query: "/tmp/reversed.ts:5-3",
				result: "",
				error:
					"Invalid file range: start_line must be less than or equal to end_line (received start_line: 5, end_line: 3)",
				success: false,
			},
			{
				query: "/tmp/valid-b.ts",
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
							"The absolute file path of a text file to read content from",
					},
					start_line: {
						anyOf: [{ type: "integer" }, { type: "null" }],
						description:
							"Optional one-based starting line number to read from; use null or omit for the start of the file",
					},
					end_line: {
						anyOf: [{ type: "integer" }, { type: "null" }],
						description:
							"Optional one-based ending line number to read through; use null or omit for the end of the file",
					},
				},
				required: ["path"],
			},
			description:
				"Array of file read requests. Omit start_line/end_line or set them to null to return the full file content boundaries; provide integers to return only that inclusive one-based line range. Prefer this tool over running terminal command to get file content for better performance and reliability.",
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
