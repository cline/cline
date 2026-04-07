import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import { createTool } from "@clinebot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentExtension, Tool } from "./types";

type FakeChunk = Record<string, unknown>;

type FakeHandler = {
	createMessage: ReturnType<typeof vi.fn>;
	getModel: ReturnType<typeof vi.fn>;
	getMessages: ReturnType<typeof vi.fn>;
	setAbortSignal?: ReturnType<typeof vi.fn>;
};

const createHandlerMock = vi.fn<(config: unknown) => FakeHandler>();
const toProviderConfigMock = vi.fn((settings: unknown) => {
	const model =
		typeof settings === "object" && settings !== null && "model" in settings
			? settings.model
			: undefined;

	return {
		knownModels:
			typeof model === "string"
				? {
						[model]: {
							id: model,
							pricing: { input: 1, output: 1 },
						},
					}
				: undefined,
	};
});

vi.mock("@clinebot/llms", () => ({
	createHandler: (config: unknown) => createHandlerMock(config),
	toProviderConfig: (settings: unknown) => toProviderConfigMock(settings),
}));

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

function makeHandler(turns: FakeChunk[][]): FakeHandler {
	let index = 0;
	return {
		createMessage: vi.fn(() => {
			const chunks = turns[index] ?? [];
			index += 1;
			return streamChunks(chunks);
		}),
		getModel: vi.fn(() => ({
			id: "mock-model",
			info: {},
		})),
		getMessages: vi.fn(),
	};
}

describe("Agent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs a basic single turn and returns final text", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "Hello from model" },
				{ type: "usage", id: "r1", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const events: string[] = [];
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [],
			onEvent: (event) => events.push(event.type),
		});

		const result = await agent.run("Say hello");

		expect(result.finishReason).toBe("completed");
		expect(result.text).toBe("Hello from model");
		expect(result.iterations).toBe(1);
		expect(result.usage.inputTokens).toBe(10);
		expect(result.usage.outputTokens).toBe(5);
		expect(events).toContain("done");
		expect(toProviderConfigMock).toHaveBeenCalled();
	});

	it("keeps totalCost undefined when usage chunks omit cost", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "Hello from model" },
				{ type: "usage", id: "r1", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [],
		});

		const result = await agent.run("Say hello");

		expect(result.usage.totalCost).toBeUndefined();
	});

	it("passes providerConfig through to handler creation", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "vertex",
			modelId: "claude-sonnet-4@20250514",
			systemPrompt: "You are helpful.",
			tools: [],
			providerConfig: {
				providerId: "vertex",
				modelId: "claude-sonnet-4@20250514",
				gcp: {
					projectId: "test-project",
					region: "us-central1",
				},
			} as LlmsProviders.ProviderConfig,
		});

		await agent.run("hello");

		expect(createHandlerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "vertex",
				modelId: "claude-sonnet-4@20250514",
				gcp: {
					projectId: "test-project",
					region: "us-central1",
				},
			}),
		);
	});

	it("emits loop logs to provided logger", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "Hello from model" },
				{ type: "usage", id: "r1", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		};
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [],
			logger,
		});

		await agent.run("Say hello");

		expect(
			logger.info.mock.calls.some(
				([message]) =>
					typeof message === "string" && message.includes("Agent loop started"),
			),
		).toBe(true);
		expect(
			logger.info.mock.calls.some(
				([message]) =>
					typeof message === "string" &&
					message.includes("Agent loop finished"),
			),
		).toBe(true);
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("fails after reaching max consecutive mistakes by default", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "done",
					id: "r1",
					success: false,
					error: "upstream api timeout",
				},
			],
			[
				{
					type: "done",
					id: "r2",
					success: false,
					error: "upstream api timeout",
				},
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Handle retries",
			tools: [],
			execution: { maxConsecutiveMistakes: 2 },
		});

		const result = await agent.run("retry");
		expect(result.finishReason).toBe("mistake_limit");
		expect(handler.createMessage).toHaveBeenCalledTimes(2);
	});

	it("stops at the mistake limit and can resume from preserved state", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "editor",
							arguments: '{"command":"create","path":/tmp/file.txt}',
						},
					},
				},
				{ type: "done", id: "r1", success: true },
			],
			[
				{
					type: "tool_calls",
					id: "r2",
					tool_call: {
						call_id: "call_2",
						function: {
							name: "editor",
							arguments: '{"command":"create","path":/tmp/file.txt}',
						},
					},
				},
				{ type: "done", id: "r2", success: true },
			],
			[
				{ type: "text", id: "r3", text: "Recovered after resume." },
				{ type: "done", id: "r3", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const notices: string[] = [];
		const errors: string[] = [];
		const stopNotices: string[] = [];
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools.",
			tools: [],
			execution: { maxConsecutiveMistakes: 2 },
			onEvent: (event) => {
				if (event.type === "notice") {
					notices.push(event.message);
					if (event.noticeType === "stop") {
						stopNotices.push(event.message);
					}
				}
				if (event.type === "error") {
					errors.push(event.error.message);
				}
			},
		});

		const first = await agent.run("try editing a file");
		expect(first.finishReason).toBe("mistake_limit");
		expect(first.messages.at(-1)).toMatchObject({
			role: "user",
			metadata: {
				kind: "stop_notice",
				reason: "mistake_limit",
				displayRole: "status",
			},
		});
		expect(stopNotices).toHaveLength(1);
		expect(notices).toContain(
			"One or more tool calls were invalid or missing required parameters (editor [call_1]: Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.). Retry with valid tool names and arguments.",
		);
		expect(errors).toContain(
			"One or more tool calls were invalid or missing required parameters (editor [call_1]: Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.). Retry with valid tool names and arguments.",
		);

		const resumed = await agent.continue("resume from the latest state");
		expect(resumed.finishReason).toBe("completed");
		expect(resumed.text).toBe("Recovered after resume.");
		expect(handler.createMessage).toHaveBeenCalledTimes(3);
	});

	it("recovers from missing tool call arguments and retries", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: { name: "editor", arguments: "" },
					},
				},
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Recovered" },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools.",
			tools: [],
		});

		const result = await agent.run("try editing");
		expect(result.finishReason).toBe("completed");
		expect(result.text).toBe("Recovered");
		expect(handler.createMessage).toHaveBeenCalledTimes(2);
	});

	it("recovers from long text + truncated tool call (max_tokens scenario)", async () => {
		const { Agent } = await import("./agent.js");
		const longText = "A".repeat(5000);
		const editorTool = createTool({
			name: "editor",
			description: "Edit files",
			inputSchema: {
				type: "object",
				properties: { command: { type: "string" } },
				required: ["command"],
			},
			execute: async (input: { command: string }) => ({
				result: input.command,
			}),
		}) as Tool;

		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: longText },
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: { id: "call_1", name: "editor" },
					},
				},
				{
					type: "done",
					id: "r1",
					success: true,
					incompleteReason: "max_tokens",
				},
			],
			[
				{
					type: "tool_calls",
					id: "r2",
					tool_call: {
						call_id: "call_2",
						function: {
							name: "editor",
							arguments: { command: "view" },
						},
					},
				},
				{ type: "done", id: "r2", success: true },
			],
			[
				{ type: "text", id: "r3", text: "Done" },
				{ type: "done", id: "r3", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const events: Array<{ type: string; recoverable?: boolean }> = [];
		const agent = new Agent({
			providerId: "openrouter",
			modelId: "mock-model",
			systemPrompt: "Edit files.",
			tools: [editorTool],
			onEvent: (event) => {
				if (event.type === "error") {
					events.push({
						type: "error",
						recoverable: event.recoverable,
					});
				}
			},
		});

		const result = await agent.run("edit the file with a long analysis");
		expect(result.finishReason).toBe("completed");
		expect(result.text).toBe("Done");
		expect(handler.createMessage).toHaveBeenCalledTimes(3);
		const recoverableErrors = events.filter(
			(e) => e.type === "error" && e.recoverable,
		);
		expect(recoverableErrors.length).toBeGreaterThanOrEqual(1);
	});

	it("uses the default consecutive mistake limit of 6 when config omits it", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "done",
					id: "r1",
					success: false,
					error: "upstream api timeout",
				},
			],
			[
				{
					type: "done",
					id: "r2",
					success: false,
					error: "upstream api timeout",
				},
			],
			[
				{
					type: "done",
					id: "r3",
					success: false,
					error: "upstream api timeout",
				},
			],
			[
				{ type: "text", id: "r4", text: "should not run" },
				{
					type: "done",
					id: "r4",
					success: false,
					error: "upstream api timeout",
				},
			],
			[
				{
					type: "done",
					id: "r5",
					success: false,
					error: "upstream api timeout",
				},
			],
			[
				{
					type: "done",
					id: "r6",
					success: false,
					error: "upstream api timeout",
				},
			],
			[
				{ type: "text", id: "r7", text: "should not run" },
				{ type: "done", id: "r7", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Handle retries",
			tools: [],
		});

		const result = await agent.run("retry");
		expect(result.finishReason).toBe("mistake_limit");
		expect(handler.createMessage).toHaveBeenCalledTimes(6);
	});

	it("fails immediately on non-recoverable API errors", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "done",
					id: "r1",
					success: false,
					error:
						'{"error":{"code":404,"message":"models/gemini-flash-latest-1 is not found"}}',
				},
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "gemini",
			modelId: "gemini-flash-latest-1",
			systemPrompt: "Handle retries",
			tools: [],
			execution: { maxConsecutiveMistakes: 3 },
		});

		await expect(agent.run("retry")).rejects.toThrow("404");
		expect(handler.createMessage).toHaveBeenCalledTimes(1);
		expect(
			agent
				.getMessages()
				.some((message) =>
					JSON.stringify(message).includes("previous turn failed"),
				),
		).toBe(false);
	});

	it("emits stop-error hooks when a non-recoverable API error ends the turn", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "done",
					id: "r1",
					success: false,
					error: '{"error":{"code":429,"message":"rate limit exceeded"}}',
				},
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onStopError = vi.fn();
		const onError = vi.fn();
		const agent = new Agent({
			providerId: "gemini",
			modelId: "mock-model",
			systemPrompt: "Handle retries",
			tools: [],
			hooks: {
				onStopError,
				onError,
			},
		});

		await expect(agent.run("retry")).rejects.toThrow("429");
		expect(onStopError).toHaveBeenCalledTimes(1);
		expect(onStopError).toHaveBeenCalledWith(
			expect.objectContaining({
				iteration: 1,
				error: expect.objectContaining({
					message: expect.stringContaining("429"),
				}),
			}),
		);
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it("fails immediately on missing api key errors", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "done",
					id: "r1",
					success: false,
					error:
						'Missing API key for provider "cline". Set apiKey explicitly or one of: CLINE_API_KEY.',
				},
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "cline",
			modelId: "anthropic/claude-sonnet-4.6",
			systemPrompt: "Handle retries",
			tools: [],
		});

		await expect(agent.run("retry")).rejects.toThrow("Missing API key");
		expect(handler.createMessage).toHaveBeenCalledTimes(1);
		expect(
			agent
				.getMessages()
				.some((message) =>
					JSON.stringify(message).includes("previous turn failed"),
				),
		).toBe(false);
	});

	it("continues after mistake limit when callback returns continue", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{
					type: "done",
					id: "r1",
					success: false,
					error: "temporary api failure",
				},
			],
			[
				{
					type: "done",
					id: "r2",
					success: false,
					error: "temporary api failure",
				},
			],
			[
				{ type: "text", id: "r3", text: "Recovered" },
				{ type: "usage", id: "r3", inputTokens: 3, outputTokens: 2 },
				{ type: "done", id: "r3", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onConsecutiveMistakeLimitReached = vi.fn().mockResolvedValue({
			action: "continue",
			guidance: "mistake_limit_reached: continue and recover",
		});
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Handle retries",
			tools: [],
			execution: { maxConsecutiveMistakes: 2 },
			onConsecutiveMistakeLimitReached,
		});

		const result = await agent.run("retry");
		expect(onConsecutiveMistakeLimitReached).toHaveBeenCalledTimes(1);
		expect(result.finishReason).toBe("completed");
		expect(result.text).toBe("Recovered");
	});

	it("fails stalled provider turns when apiTimeoutMs is reached", async () => {
		const { Agent } = await import("./agent.js");
		let activeAbortSignal: AbortSignal | undefined;
		const handler: FakeHandler = {
			createMessage: vi.fn(
				() =>
					({
						async *[Symbol.asyncIterator]() {
							if (!activeAbortSignal) {
								await new Promise(() => {});
								return;
							}
							await new Promise<void>((resolve) => {
								if (activeAbortSignal?.aborted) {
									resolve();
									return;
								}
								activeAbortSignal?.addEventListener("abort", () => resolve(), {
									once: true,
								});
							});
						},
					}) as AsyncGenerator<FakeChunk>,
			),
			getModel: vi.fn(() => ({
				id: "mock-model",
				info: {},
			})),
			getMessages: vi.fn(),
			setAbortSignal: vi.fn((signal: AbortSignal | undefined) => {
				activeAbortSignal = signal;
			}),
		};
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Handle stalled providers",
			tools: [],
			apiTimeoutMs: 10,
			execution: { maxConsecutiveMistakes: 1 },
		});

		const result = await agent.run("retry");
		expect(result.finishReason).toBe("mistake_limit");
		expect(handler.setAbortSignal).toHaveBeenCalled();
	});

	it("executes tool calls and applies tool policy approval", async () => {
		const { Agent } = await import("./agent.js");
		const mathTool: Tool<{ a: number; b: number }, { total: number }> =
			createTool({
				name: "math_add",
				description: "Add two numbers",
				inputSchema: {
					type: "object",
					properties: {
						a: { type: "number" },
						b: { type: "number" },
					},
					required: ["a", "b"],
				},
				execute: async ({ a, b }) => ({ total: a + b }),
			});
		const genericMathTool = mathTool as Tool;

		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "math_add",
							arguments: JSON.stringify({ a: 2, b: 3 }),
						},
					},
				},
				{ type: "usage", id: "r1", inputTokens: 20, outputTokens: 8 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Done" },
				{ type: "usage", id: "r2", inputTokens: 12, outputTokens: 4 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const approval = vi.fn().mockResolvedValue({ approved: true });
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools",
			tools: [genericMathTool],
			toolPolicies: {
				math_add: { autoApprove: false },
			},
			requestToolApproval: approval,
		});

		const result = await agent.run("compute");

		expect(approval).toHaveBeenCalledTimes(1);
		expect(result.finishReason).toBe("completed");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]?.output).toEqual({ total: 5 });
		expect(result.text).toBe("Done");
	});

	it("stops when a truncated tool fragment is repaired into a failed tool call", async () => {
		const { Agent } = await import("./agent.js");
		const strReplaceTool = createTool({
			name: "str_replace",
			description: "Replace text in a file",
			inputSchema: {
				type: "object",
				properties: {
					command: { type: "string" },
					path: { type: "string" },
					old_str: { type: "string" },
					new_str: { type: "string" },
				},
				required: ["command", "path", "old_str", "new_str"],
			},
			retryable: false,
			maxRetries: 0,
			execute: async (input: {
				command?: string;
				path?: string;
				old_str?: string;
				new_str?: string;
			}) => {
				if (!input.old_str || !input.new_str) {
					throw new Error("missing replacement payload");
				}
				return { ok: true };
			},
		}) as Tool;

		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "str_replace",
							arguments: '{"command":"str_replace","path":"/some/file"',
						},
					},
				},
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Run the replacement tool",
			tools: [strReplaceTool],
			execution: { maxConsecutiveMistakes: 1 },
		});

		const result = await agent.run("replace this text");
		expect(result.finishReason).toBe("mistake_limit");
		expect(handler.createMessage).toHaveBeenCalledTimes(1);
	});

	it("requests approval when a tool_call_before hook returns review", async () => {
		const { Agent } = await import("./agent.js");
		const runCommandsTool = createTool({
			name: "run_commands",
			description: "Run shell commands",
			inputSchema: {
				type: "object",
				properties: {
					commands: {
						type: "array",
						items: { type: "string" },
					},
				},
				required: ["commands"],
			},
			execute: async (input: { commands: string[] }) => input.commands,
		}) as Tool;
		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "run_commands",
							arguments: JSON.stringify({ commands: ["git status"] }),
						},
					},
				},
				{ type: "usage", id: "r1", inputTokens: 20, outputTokens: 8 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Done" },
				{ type: "usage", id: "r2", inputTokens: 12, outputTokens: 4 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const approval = vi.fn().mockResolvedValue({ approved: true });
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools",
			tools: [runCommandsTool],
			hooks: {
				onToolCallStart: async () => ({
					review: true,
					context: "Git commands require explicit user approval.",
				}),
			},
			requestToolApproval: approval,
		});

		const result = await agent.run("check git status");

		expect(approval).toHaveBeenCalledTimes(1);
		expect(result.finishReason).toBe("completed");
		expect(result.toolCalls[0]?.error).toBeUndefined();
		expect(result.toolCalls[0]?.output).toEqual(["git status"]);
	});

	it("does not request approval when no hook asks for review", async () => {
		const { Agent } = await import("./agent.js");
		const runCommandsTool = createTool({
			name: "run_commands",
			description: "Run shell commands",
			inputSchema: {
				type: "object",
				properties: {
					commands: {
						type: "array",
						items: { type: "string" },
					},
				},
				required: ["commands"],
			},
			execute: async (input: { commands: string[] }) => input.commands,
		}) as Tool;
		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "run_commands",
							arguments: JSON.stringify({ commands: ["git status"] }),
						},
					},
				},
				{ type: "usage", id: "r1", inputTokens: 20, outputTokens: 8 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Done" },
				{ type: "usage", id: "r2", inputTokens: 12, outputTokens: 4 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const approval = vi.fn().mockResolvedValue({ approved: true });
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools",
			tools: [runCommandsTool],
			requestToolApproval: approval,
		});

		const result = await agent.run("check git status");

		expect(approval).not.toHaveBeenCalled();
		expect(result.finishReason).toBe("completed");
		expect(result.toolCalls[0]?.error).toBeUndefined();
		expect(result.toolCalls[0]?.output).toEqual(["git status"]);
	});

	it("finalizes streamed tool arguments at end of turn", async () => {
		const { Agent } = await import("./agent.js");
		const teamLogTool = createTool({
			name: "team_log_update",
			description: "Append a mission log update",
			inputSchema: {
				type: "object",
				properties: {
					kind: { type: "string" },
					summary: { type: "string" },
				},
				required: ["kind", "summary"],
			},
			execute: async ({ kind, summary }) => ({ kind, summary }),
		}) as Tool;

		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "team_log_update",
							arguments: '{"kind":"progress",',
						},
					},
				},
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							arguments: '"summary":"Spawned two-agent team"}',
						},
					},
				},
				{ type: "usage", id: "r1", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Done" },
				{ type: "usage", id: "r2", inputTokens: 2, outputTokens: 1 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools",
			tools: [teamLogTool],
		});

		const result = await agent.run("log status");

		expect(result.finishReason).toBe("completed");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]?.error).toBeUndefined();
		expect(result.toolCalls[0]?.output).toEqual({
			kind: "progress",
			summary: "Spawned two-agent team",
		});
	});

	it("deduplicates streamed tool calls when function.id and call_id both appear", async () => {
		const { Agent } = await import("./agent.js");
		const executeRunCommands = vi.fn(
			async ({ commands }: { commands: string[] }) => commands,
		);
		const runCommandsTool = createTool({
			name: "run_commands",
			description: "Run commands",
			inputSchema: {
				type: "object",
				properties: {
					commands: {
						type: "array",
						items: { type: "string" },
					},
				},
				required: ["commands"],
			},
			execute: executeRunCommands,
		}) as Tool;

		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						function: {
							id: "fc_1",
							name: "run_commands",
							arguments: '{"commands":["p',
						},
					},
				},
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							id: "fc_1",
							name: "run_commands",
							arguments: 'wd"]}',
						},
					},
				},
				{ type: "usage", id: "r1", inputTokens: 4, outputTokens: 2 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Done" },
				{ type: "usage", id: "r2", inputTokens: 2, outputTokens: 1 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools",
			tools: [runCommandsTool],
		});

		const result = await agent.run("run a command");
		expect(result.finishReason).toBe("completed");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]?.error).toBeUndefined();
		expect(result.toolCalls[0]?.output).toEqual(["pwd"]);
		expect(executeRunCommands).toHaveBeenCalledTimes(1);
	});

	it("passes through array-shaped read_files tool args", async () => {
		const { Agent } = await import("./agent.js");
		const readFilesTool = createTool({
			name: "read_files",
			description: "Read multiple files",
			inputSchema: {
				type: "object",
				properties: {
					file_paths: {
						type: "array",
						items: { type: "string" },
					},
				},
				required: ["file_paths"],
			},
			execute: async ({ file_paths }) => ({ file_paths }),
		}) as Tool;

		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "read_files",
							arguments: '["/tmp/a.ts","/tmp/b.ts"]',
						},
					},
				},
				{ type: "usage", id: "r1", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Done" },
				{ type: "usage", id: "r2", inputTokens: 2, outputTokens: 1 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools",
			tools: [readFilesTool],
		});

		const result = await agent.run("read files");
		expect(result.finishReason).toBe("completed");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]?.error).toBeUndefined();
		expect(result.toolCalls[0]?.input).toEqual(["/tmp/a.ts", "/tmp/b.ts"]);
	});

	it("continues conversation and clearHistory resets message state", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "First turn" },
				{ type: "usage", id: "r1", inputTokens: 4, outputTokens: 3 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Second turn" },
				{ type: "usage", id: "r2", inputTokens: 5, outputTokens: 2 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Continue support",
			tools: [],
		});

		await agent.run("one");
		const beforeContinueMessages = agent.getMessages();
		expect(beforeContinueMessages.length).toBeGreaterThanOrEqual(2);

		const second = await agent.continue("two");
		expect(second.text).toBe("Second turn");
		expect(agent.getMessages().length).toBeGreaterThan(
			beforeContinueMessages.length,
		);

		agent.clearHistory();
		expect(agent.getMessages()).toEqual([]);
	});

	it("restores preloaded messages via config and restore()", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "restored" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "restored-again" },
				{ type: "usage", id: "r2", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const initial: LlmsProviders.Message[] = [
			{ role: "user", content: [{ type: "text", text: "history" }] },
		];
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Restore support",
			tools: [],
			initialMessages: initial,
		});

		expect(agent.getMessages()).toEqual(initial);
		const first = await agent.continue("resume");
		expect(first.text).toBe("restored");

		const restored: LlmsProviders.Message[] = [
			{ role: "assistant", content: [{ type: "text", text: "new-state" }] },
		];
		const conversationIdBeforeRestore = agent.getConversationId();
		agent.restore(restored);
		expect(agent.getMessages()).toEqual(restored);
		expect(agent.getConversationId()).toBe(conversationIdBeforeRestore);
		const second = await agent.continue("resume-2");
		expect(second.text).toBe("restored-again");
	});

	it("supports shutdown hooks and early run cancellation via hook control", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "Should not run" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onSessionShutdown = vi.fn().mockResolvedValue(undefined);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "cancel fast",
			tools: [],
			hooks: {
				onRunStart: () => ({ cancel: true }),
				onSessionShutdown,
			},
		});

		const result = await agent.run("cancel this");
		expect(result.finishReason).toBe("aborted");
		expect(result.iterations).toBe(0);
		expect(handler.createMessage).not.toHaveBeenCalled();

		await agent.shutdown("test-end");
		expect(onSessionShutdown).toHaveBeenCalledTimes(1);
	});

	it("dispatches onRuntimeEvent through HookEngine extension stage", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onRuntimeEvent = vi.fn().mockResolvedValue(undefined);
		const extension: AgentExtension = {
			name: "runtime-ext",
			manifest: {
				capabilities: ["hooks"],
				hookStages: ["runtime_event"],
			},
			onRuntimeEvent,
		};

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "runtime events",
			tools: [],
			extensions: [extension],
		});

		await agent.run("trigger");

		expect(onRuntimeEvent).toHaveBeenCalled();
		expect(
			onRuntimeEvent.mock.calls.some((args) => args[0]?.event?.type === "done"),
		).toBe(true);
	});

	it("registers extension contributions through ContributionRegistry setup", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const extensionTool = createTool({
			name: "ext_echo",
			description: "Echo back text",
			inputSchema: {
				type: "object",
				properties: { value: { type: "string" } },
				required: ["value"],
			},
			execute: async ({ value }: { value: string }) => ({ value }),
		}) as Tool;
		const extension: AgentExtension = {
			name: "contrib-ext",
			manifest: {
				capabilities: ["tools", "commands"],
			},
			setup: (api) => {
				api.registerTool(extensionTool);
				api.registerCommand({ name: "ext:hello", description: "hello cmd" });
			},
		};

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "contrib events",
			tools: [],
			extensions: [extension],
		});

		await agent.run("trigger");
		const registry = agent.getExtensionRegistry();
		expect(registry.tools.map((tool) => tool.name)).toContain("ext_echo");
		expect(registry.commands.map((command) => command.name)).toContain(
			"ext:hello",
		);
	});

	it("validates extension manifest hook stage declarations", async () => {
		const { Agent } = await import("./agent.js");

		const invalidExtension: AgentExtension = {
			name: "invalid-ext",
			manifest: {
				capabilities: ["hooks"],
				hookStages: ["runtime_event"],
			},
			onInput: () => undefined,
		};

		expect(
			() =>
				new Agent({
					providerId: "anthropic",
					modelId: "mock-model",
					systemPrompt: "invalid",
					tools: [],
					extensions: [invalidExtension],
				}),
		).toThrow(/declared but handler "onRuntimeEvent" is missing/i);
	});

	it("supports event subscriptions without mutating config callbacks", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onEvent = vi.fn();
		const subscriberA = vi.fn();
		const subscriberB = vi.fn();
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "events",
			tools: [],
			onEvent,
		});

		const unsubscribeA = agent.subscribeEvents(subscriberA);
		const unsubscribeB = agent.subscribeEvents(subscriberB);
		unsubscribeB();

		await agent.run("hello");

		expect(onEvent).toHaveBeenCalled();
		expect(subscriberA).toHaveBeenCalled();
		expect(subscriberB).not.toHaveBeenCalled();

		unsubscribeA();
	});

	it("dispatches newly supported extension lifecycle stages", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "done" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		handler.getModel = vi.fn(() => ({
			id: "mock-model",
			info: { contextWindow: 2 },
		}));
		createHandlerMock.mockReturnValue(handler);

		const onRunStart = vi.fn(() => undefined);
		const onIterationStart = vi.fn(() => undefined);
		const onTurnStart = vi.fn(() => undefined);
		const onContextLimitReached = vi.fn(() => undefined);
		const onIterationEnd = vi.fn(async () => undefined);
		const onRunEnd = vi.fn(async () => undefined);
		const extension: AgentExtension = {
			name: "lifecycle-extension",
			manifest: {
				capabilities: ["hooks"],
				hookStages: [
					"run_start",
					"iteration_start",
					"turn_start",
					"context_limit_reached",
					"iteration_end",
					"run_end",
				],
			},
			onRunStart,
			onIterationStart,
			onTurnStart,
			onContextLimitReached,
			onIterationEnd,
			onRunEnd,
		};

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "hooks",
			tools: [],
			extensions: [extension],
		});

		await agent.run("hello");

		expect(onRunStart).toHaveBeenCalledTimes(1);
		expect(onIterationStart).toHaveBeenCalledTimes(1);
		expect(onTurnStart).toHaveBeenCalledTimes(1);
		expect(onContextLimitReached).toHaveBeenCalledTimes(1);
		expect(onIterationEnd).toHaveBeenCalledTimes(1);
		expect(onRunEnd).toHaveBeenCalledTimes(1);
	});

	it("dispatches before-agent-start hooks before the model turn", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "done" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onBeforeAgentStart = vi.fn(() => undefined);
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "hooks",
			tools: [],
			hooks: {
				onBeforeAgentStart,
			},
		});

		await agent.run("hello");

		expect(onBeforeAgentStart).toHaveBeenCalledTimes(1);
		expect(onBeforeAgentStart).toHaveBeenCalledWith(
			expect.objectContaining({
				iteration: 1,
				systemPrompt: "hooks",
			}),
		);
	});

	it("rejects overlapping runs on the same agent instance", async () => {
		const { Agent } = await import("./agent.js");
		let releaseFirstTurn!: () => void;
		const firstTurnBlocked = new Promise<void>((resolve) => {
			releaseFirstTurn = resolve;
		});

		const handler = {
			createMessage: vi.fn(async function* () {
				yield { type: "text", id: "r1", text: "working" };
				await firstTurnBlocked;
				yield { type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 };
				yield { type: "done", id: "r1", success: true };
			}),
			getModel: vi.fn(() => ({ id: "mock-model", info: {} })),
			getMessages: vi.fn(),
		};
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "concurrency",
			tools: [],
		});

		const firstRun = agent.run("first");
		await Promise.resolve();

		await expect(agent.continue("second")).rejects.toThrow(
			/state is "running"/i,
		);

		releaseFirstTurn();
		await firstRun;
	});

	it("adds image blocks to initial user content when provided", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [],
		});

		await agent.run("Analyze this image", ["data:image/png;base64,aGVsbG8="]);

		expect(handler.createMessage).toHaveBeenCalledTimes(1);
		const requestMessages = handler.createMessage.mock.calls[0]?.[1] as Array<{
			role: string;
			content: unknown;
		}>;
		expect(requestMessages[0]?.role).toBe("user");
		expect(requestMessages[0]?.content).toEqual([
			{ type: "text", text: "Analyze this image" },
			{ type: "image", mediaType: "image/png", data: "aGVsbG8=" },
		]);
	});

	it("adds attached file content block to initial user content", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const tempDir = await mkdtemp(join(tmpdir(), "agents-run-files-"));
		const filePath = join(tempDir, "note.txt");
		try {
			await writeFile(filePath, "hello from file", "utf8");
			const agent = new Agent({
				providerId: "anthropic",
				modelId: "mock-model",
				systemPrompt: "You are helpful.",
				tools: [],
				userFileContentLoader: (path) => readFile(path, "utf8"),
			});

			await agent.run("Use this file", undefined, [filePath]);

			expect(handler.createMessage).toHaveBeenCalledTimes(1);
			const requestMessages = handler.createMessage.mock
				.calls[0]?.[1] as Array<{
				role: string;
				content: unknown;
			}>;
			expect(requestMessages[0]?.role).toBe("user");
			expect(requestMessages[0]?.content).toEqual([
				{ type: "text", text: "Use this file" },
				{
					type: "file",
					path: filePath.replace(/\\/g, "/"),
					content: "hello from file",
				},
			]);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("stops at mistake_limit when loop detection detects repeated identical tool calls", async () => {
		const { Agent } = await import("./agent.js");
		const echoTool = createTool({
			name: "echo",
			description: "Echo input",
			inputSchema: {
				type: "object",
				properties: { msg: { type: "string" } },
				required: ["msg"],
			},
			execute: async ({ msg }: { msg: string }) => ({ msg }),
		}) as Tool;

		const identicalTurn = (id: string) => [
			{
				type: "tool_calls",
				id,
				tool_call: {
					call_id: `call_${id}`,
					function: { name: "echo", arguments: '{"msg":"hi"}' },
				},
			},
			{ type: "usage", id, inputTokens: 10, outputTokens: 5 },
			{ type: "done", id, success: true },
		];
		const handler = makeHandler([
			identicalTurn("r1"),
			identicalTurn("r2"),
			identicalTurn("r3"),
			identicalTurn("r4"),
			identicalTurn("r5"),
			[
				{ type: "text", id: "r6", text: "unreachable" },
				{ type: "done", id: "r6", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Echo repeatedly",
			tools: [echoTool],
			execution: {
				loopDetection: { softThreshold: 3, hardThreshold: 5 },
				maxConsecutiveMistakes: 6,
			},
		});

		const result = await agent.run("go");
		expect(result.finishReason).toBe("mistake_limit");
		expect(result.toolCalls).toHaveLength(5);
	});

	it("runs configured compaction when turn usage crosses the context threshold", async () => {
		const { Agent } = await import("./agent.js");
		const echoTool = createTool({
			name: "echo",
			description: "Echo input",
			inputSchema: {
				type: "object",
				properties: { msg: { type: "string" } },
				required: ["msg"],
			},
			execute: async ({ msg }: { msg: string }) => ({ msg }),
		}) as Tool;
		const compact = vi.fn(async () => ({
			messages: [
				{
					role: "user" as const,
					content: "compacted history",
				},
			],
		}));
		const turns: FakeChunk[][] = [
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_r1",
						function: { name: "echo", arguments: '{"msg":"hi"}' },
					},
				},
				{ type: "usage", id: "r1", inputTokens: 70, outputTokens: 15 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "done" },
				{ type: "usage", id: "r2", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r2", success: true },
			],
		];
		let index = 0;
		const handler: FakeHandler = {
			createMessage: vi.fn((_systemPrompt, _messages) => {
				const chunks = turns[index] ?? [];
				index += 1;
				return streamChunks(chunks);
			}),
			getModel: vi.fn(() => ({
				id: "mock-model",
				info: { contextWindow: 100 },
			})),
			getMessages: vi.fn(),
		};
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [echoTool],
			compaction: { compact },
		} as never);

		const result = await agent.run("Say hello");

		expect(compact).toHaveBeenCalledTimes(1);
		expect(compact).toHaveBeenCalledWith(
			expect.objectContaining({
				iteration: 1,
				contextWindowTokens: 100,
				triggerTokens: 80,
				thresholdRatio: 0.8,
				utilizationRatio: 0.85,
				usage: expect.objectContaining({
					inputTokens: 70,
					outputTokens: 15,
					totalTokens: 85,
				}),
			}),
		);
		expect(handler.createMessage).toHaveBeenCalledTimes(2);
		expect(handler.createMessage.mock.calls[1]?.[1]).toEqual([
			{ role: "user", content: "compacted history" },
		]);
		expect(result.messages).toEqual([
			{ role: "user", content: "compacted history" },
			{
				role: "assistant",
				content: [{ type: "text", text: "done", signature: undefined }],
			},
		]);
	});

	it("prefers extension onContextLimitReached over config compaction", async () => {
		const { Agent } = await import("./agent.js");
		const configCompact = vi.fn(async () => ({
			messages: [{ role: "user" as const, content: "config compacted" }],
		}));
		const onContextLimitReached = vi.fn(() => ({
			replaceMessages: [
				{ role: "user" as const, content: "extension compacted" },
			],
		}));
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "done" },
				{ type: "usage", id: "r1", inputTokens: 70, outputTokens: 15 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		handler.getModel = vi.fn(() => ({
			id: "mock-model",
			info: { contextWindow: 100 },
		}));
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [],
			compaction: { compact: configCompact },
			extensions: [
				{
					name: "compaction-extension",
					manifest: {
						capabilities: ["hooks"],
						hookStages: ["context_limit_reached"],
					},
					onContextLimitReached,
				},
			],
		} as never);

		const result = await agent.run("hello");

		expect(onContextLimitReached).toHaveBeenCalledTimes(1);
		expect(configCompact).not.toHaveBeenCalled();
		expect(result.messages).toEqual([
			{ role: "user", content: "extension compacted" },
		]);
	});

	it("detects repeated identical tool calls within a batched iteration even when another tool runs last", async () => {
		const { Agent } = await import("./agent.js");
		const echoTool = createTool({
			name: "echo",
			description: "Echo input",
			inputSchema: {
				type: "object",
				properties: { msg: { type: "string" } },
				required: ["msg"],
			},
			execute: async ({ msg }: { msg: string }) => ({ msg }),
		}) as Tool;
		const noopTool = createTool({
			name: "noop",
			description: "Return ok",
			inputSchema: {
				type: "object",
				properties: {},
			},
			execute: async () => ({ ok: true }),
		}) as Tool;

		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1a",
					tool_call: {
						call_id: "call_1",
						function: { name: "echo", arguments: '{"msg":"hi"}' },
					},
				},
				{
					type: "tool_calls",
					id: "r1b",
					tool_call: {
						call_id: "call_2",
						function: { name: "echo", arguments: '{"msg":"hi"}' },
					},
				},
				{
					type: "tool_calls",
					id: "r1c",
					tool_call: {
						call_id: "call_3",
						function: { name: "echo", arguments: '{"msg":"hi"}' },
					},
				},
				{
					type: "tool_calls",
					id: "r1d",
					tool_call: {
						call_id: "call_4",
						function: { name: "noop", arguments: "{}" },
					},
				},
				{ type: "usage", id: "r1", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Echo repeatedly",
			tools: [echoTool, noopTool],
			execution: {
				loopDetection: { softThreshold: 2, hardThreshold: 3 },
				maxConsecutiveMistakes: 6,
			},
		});

		const result = await agent.run("go");
		expect(result.finishReason).toBe("mistake_limit");
		expect(result.toolCalls).toHaveLength(4);
	});
});
