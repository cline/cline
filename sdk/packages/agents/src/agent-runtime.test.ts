import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimePlugin,
	AgentTool,
} from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./index";

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];

	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}

	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return toAsyncIterable(step(request));
	}
}

async function* toAsyncIterable(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) {
		yield event;
	}
}

const createEchoTool = (): AgentTool<{ text: string }, { echoed: string }> => ({
	name: "echo",
	description: "Echo input text",
	inputSchema: { type: "object" },
	async execute(input) {
		return { output: { echoed: input.text } };
	},
});

describe("AgentRuntime", () => {
	it("completes a simple turn without tools", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "hello" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({ model });

		const result = await runtime.run("Hi");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("hello");
		expect(result.messages).toHaveLength(2);
		expect(model.requests).toHaveLength(1);
	});

	it("executes a tool call and continues the loop", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "echo",
					inputText: '{"text":"hi"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({ model, tools: [createEchoTool()] });

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(
			result.messages.filter((message) => message.role === "tool"),
		).toHaveLength(1);
		expect(result.outputText).toBe("done");
	});

	it("stores tool calls but skips execution when metadata disables external execution", async () => {
		const executeTool = vi.fn(async () => ({ output: { echoed: "hi" } }));
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "echo",
					inputText: '{"text":"hi"}',
					metadata: {
						toolSource: {
							providerId: "openai-codex",
							modelId: "gpt-5-codex",
							executionMode: "provider",
						},
					},
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [
				{
					name: "echo",
					description: "Echo input text",
					inputSchema: { type: "object" },
					execute: executeTool,
				},
			],
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("done");
		expect(executeTool).not.toHaveBeenCalled();
		const toolMessages = result.messages.filter(
			(message) => message.role === "tool",
		);
		expect(toolMessages).toHaveLength(1);
		expect(toolMessages[0]?.content).toEqual([
			expect.objectContaining({
				type: "tool-result",
				toolCallId: "call_1",
				toolName: "echo",
				isError: true,
				output: {
					error: "Tool execution is disabled for provider openai-codex",
				},
			}),
		]);
	});

	it("shows provider-disabled message even when tool is not registered locally", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "shell",
					inputText: '{"command":"echo hi"}',
					metadata: {
						toolSource: {
							providerId: "openai-codex",
							executionMode: "provider",
						},
					},
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [], // shell tool is not registered
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("done");
		const toolMessages = result.messages.filter(
			(message) => message.role === "tool",
		);
		expect(toolMessages).toHaveLength(1);
		expect(toolMessages[0]?.content).toEqual([
			expect.objectContaining({
				type: "tool-result",
				toolCallId: "call_1",
				toolName: "shell",
				isError: true,
				output: {
					error: "Tool execution is disabled for provider openai-codex",
				},
			}),
		]);
	});

	it("treats an unset maxIterations as unlimited", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "echo",
					inputText: '{"text":"first"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_2",
					toolName: "echo",
					inputText: '{"text":"second"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({ model, tools: [createEchoTool()] });

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(3);
		expect(result.outputText).toBe("done");
	});

	it("supports plugin-contributed tools and hooks", async () => {
		const beforeRun = vi.fn();
		const plugin: AgentRuntimePlugin = {
			name: "plugin-tool",
			setup: () => ({
				hooks: {
					beforeRun,
				},
				tools: [
					{
						name: "plugin_tool",
						description: "Provided by a plugin",
						inputSchema: { type: "object" },
						execute: async () => ({ output: { ok: true } }),
					},
				],
			}),
		};
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_plugin",
					toolName: "plugin_tool",
					inputText: "{}",
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "plugin complete" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({ model, plugins: [plugin] });
		const result = await runtime.run("Run plugin");

		expect(beforeRun).toHaveBeenCalledOnce();
		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("plugin complete");
	});

	it("unwinds cleanly when beforeRun stops the run", async () => {
		const events: string[] = [];
		let stopNextRun = true;
		const runtime = new AgentRuntime({
			model: new ScriptedModel([
				() => [
					{ type: "text-delta", text: "second run" },
					{ type: "finish", reason: "stop" },
				],
			]),
			hooks: {
				beforeRun: async () => {
					if (!stopNextRun) {
						return undefined;
					}
					stopNextRun = false;
					return { stop: true, reason: "blocked" };
				},
			},
		});
		runtime.subscribe((event) => {
			events.push(event.type);
		});

		const first = await runtime.run("first");
		const second = await runtime.run("second");

		expect(first.status).toBe("aborted");
		expect(first.error).toBeUndefined();
		expect(events[0]).toBe("run-finished");
		expect(events).toContain("run-started");
		expect(events.at(-1)).toBe("run-finished");
		expect(second.status).toBe("completed");
		expect(second.outputText).toBe("second run");
		expect(runtime.snapshot().status).toBe("completed");
	});

	it("annotates assistant messages with per-turn metrics and model info", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "usage",
					usage: {
						inputTokens: 12,
						outputTokens: 7,
						cacheReadTokens: 3,
						cacheWriteTokens: 2,
						totalCost: 0.42,
					},
				},
				{ type: "text-delta", text: "hello" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			messageModelInfo: {
				id: "anthropic/claude-sonnet-4.6",
				provider: "openrouter",
				family: "claude-sonnet",
			},
		});

		const result = await runtime.run("Hi");
		const assistant = result.messages.at(-1);

		expect(assistant?.role).toBe("assistant");
		expect(assistant?.modelInfo).toEqual({
			id: "anthropic/claude-sonnet-4.6",
			provider: "openrouter",
			family: "claude-sonnet",
		});
		expect(assistant?.metrics).toEqual({
			inputTokens: 12,
			outputTokens: 7,
			cacheReadTokens: 3,
			cacheWriteTokens: 2,
			cost: 0.42,
		});
	});

	it("stops a run from beforeModel hooks and returns an aborted result", async () => {
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "should not happen" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			hooks: {
				beforeModel: () => ({ stop: true, reason: "approval required" }),
			},
		});

		const result = await runtime.run("Stop early");

		expect(result.status).toBe("aborted");
		expect(result.error).toBeUndefined();
		expect(result.outputText).toBe("");
		expect(model.requests).toHaveLength(0);
	});

	it("can block a tool through beforeTool hooks", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "blocked",
					toolName: "echo",
					inputText: '{"text":"x"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolResult = request.messages.at(-1)?.content[0];
				expect(toolResult).toMatchObject({
					type: "tool-result",
					isError: true,
				});
				return [
					{ type: "text-delta", text: "recovered" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEchoTool()],
			hooks: {
				beforeTool: () => ({ skip: true, reason: "policy denied" }),
			},
		});

		const result = await runtime.run("Block it");

		expect(result.status).toBe("completed");
		const toolMessage = result.messages.find(
			(message) => message.role === "tool",
		);
		expect(toolMessage?.content[0]).toMatchObject({
			type: "tool-result",
			isError: true,
		});
	});

	it("treats invalid tool-call JSON as a tool error instead of failing the run", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "bad_json",
					toolName: "echo",
					inputText: '{"text":"bad\\x"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolResult = request.messages.at(-1)?.content[0];
				expect(toolResult).toMatchObject({
					type: "tool-result",
					toolName: "echo",
					isError: true,
					output: {
						error: expect.stringContaining(
							"Tool call echo emitted invalid JSON arguments",
						),
					},
				});
				return [
					{ type: "text-delta", text: "recovered" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({ model, tools: [createEchoTool()] });

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("recovered");
	});

	it("accepts corrected full argument snapshots for the same streamed tool call", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "echo",
					inputText: '{"text":"oops"}',
				},
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "echo",
					inputText: '{"text":"fixed"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolResult = request.messages.at(-1)?.content[0];
				expect(toolResult).toMatchObject({
					type: "tool-result",
					toolName: "echo",
					output: { echoed: "fixed" },
				});
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({ model, tools: [createEchoTool()] });

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("done");
	});

	it("executes tools in parallel but preserves assistant order in appended messages", async () => {
		const executionOrder: string[] = [];
		const finishOrder: string[] = [];
		const slow: AgentTool = {
			name: "slow",
			description: "slow tool",
			inputSchema: { type: "object" },
			async execute() {
				executionOrder.push("slow-start");
				await new Promise((resolve) => setTimeout(resolve, 25));
				finishOrder.push("slow-finish");
				return { output: { name: "slow" } };
			},
		};
		const fast: AgentTool = {
			name: "fast",
			description: "fast tool",
			inputSchema: { type: "object" },
			async execute() {
				executionOrder.push("fast-start");
				finishOrder.push("fast-finish");
				return { output: { name: "fast" } };
			},
		};
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "slow_call",
					toolName: "slow",
					inputText: "{}",
				},
				{
					type: "tool-call-delta",
					toolCallId: "fast_call",
					toolName: "fast",
					inputText: "{}",
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);

		const runtime = new AgentRuntime({
			model,
			tools: [slow, fast],
			toolExecution: "parallel",
		});

		const result = await runtime.run("Parallel");

		expect(executionOrder).toEqual(["slow-start", "fast-start"]);
		expect(finishOrder).toEqual(["fast-finish", "slow-finish"]);
		const toolMessages = result.messages.filter(
			(message) => message.role === "tool",
		);
		expect(toolMessages[0]?.content[0]).toMatchObject({ toolName: "slow" });
		expect(toolMessages[1]?.content[0]).toMatchObject({ toolName: "fast" });
	});

	it("captures events, logger calls, telemetry, and failed tool runs", async () => {
		const telemetry = { capture: vi.fn() };
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const events: string[] = [];
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "boom_call",
					toolName: "boom",
					inputText: "{}",
				},
				{ type: "finish", reason: "tool-calls" },
			],
			() => [{ type: "finish", reason: "error", error: "model failed" }],
		]);
		const runtime = new AgentRuntime({
			model,
			logger,
			telemetry,
			tools: [
				{
					name: "boom",
					description: "throws",
					inputSchema: { type: "object" },
					async execute() {
						throw new Error("tool exploded");
					},
				},
			],
		});
		runtime.subscribe((event) => {
			events.push(event.type);
		});

		const result = await runtime.run("Fail");

		expect(result.status).toBe("failed");
		expect(events).toContain("run-failed");
		expect(logger.error).toHaveBeenCalled();
		expect(telemetry.capture).toHaveBeenCalled();
	});

	it("propagates agent identity including role through snapshots and plugin setup", async () => {
		const setup = vi.fn(() => undefined);
		const plugin: AgentRuntimePlugin = {
			name: "identity",
			setup,
		};
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "ok" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			agentId: "lead-1",
			agentRole: "lead",
			model,
			plugins: [plugin],
		});

		const snapshots: Array<{ agentId: string; agentRole?: string }> = [];
		runtime.subscribe((event) => {
			snapshots.push({
				agentId: event.snapshot.agentId,
				agentRole: event.snapshot.agentRole,
			});
		});

		const result = await runtime.run("Identity");

		expect(setup).toHaveBeenCalledWith({
			agentId: "lead-1",
			agentRole: "lead",
			systemPrompt: undefined,
		});
		expect(result.agentId).toBe("lead-1");
		expect(result.agentRole).toBe("lead");
		expect(snapshots.every((snapshot) => snapshot.agentId === "lead-1")).toBe(
			true,
		);
		expect(snapshots.every((snapshot) => snapshot.agentRole === "lead")).toBe(
			true,
		);
	});
});
