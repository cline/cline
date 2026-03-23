import { describe, expect, it, vi } from "vitest";
import {
	createBashTool,
	createDefaultTools,
	createReadFilesTool,
} from "./definitions.js";

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
				skills: async () => "ok",
			},
			enableSkills: true,
		});
		expect(toolsWithExecutor.map((tool) => tool.name)).toContain("skills");
	});

	it("validates and executes skill invocation input", async () => {
		const execute = vi.fn(async () => "loaded");
		const tools = createDefaultTools({
			executors: {
				skills: execute,
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
		const execute = vi.fn(async (command: string) => `ran:${command}`);
		const tool = createBashTool(execute);

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
});

describe("zod schema conversion", () => {
	it("preserves read_files required properties in generated JSON schema", () => {
		const tool = createReadFilesTool(async () => "ok");
		const inputSchema = tool.inputSchema as Record<string, unknown>;
		const properties = inputSchema.properties as Record<string, unknown>;
		expect(inputSchema.type).toBe("object");
		expect(properties.file_paths).toEqual({
			type: "array",
			items: {
				type: "string",
				description:
					"The absolute file path of a text file to read content from",
			},
			description:
				"Array of absolute file paths to get full content from. Prefer this tool over running terminal command to get file content for better performance and reliability.",
		});
		expect(inputSchema.required).toEqual(["file_paths"]);
	});

	it("exposes skills args as optional nullable in tool schemas", () => {
		const tools = createDefaultTools({
			executors: {
				skills: async () => "ok",
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
});
