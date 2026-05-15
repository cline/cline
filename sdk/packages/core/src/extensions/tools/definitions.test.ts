import { describe, expect, it, vi } from "vitest";
import {
	createDefaultTools,
	createReadFilesTool,
	createSkillsTool,
	createWindowsShellTool,
} from "./definitions";
import { INPUT_ARG_CHAR_LIMIT } from "./schemas";
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
		const tool = createWindowsShellTool(execute);

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
		);
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
