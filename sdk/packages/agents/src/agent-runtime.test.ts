import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimePlugin,
	AgentTool,
	ITelemetryService,
} from "@cline/shared";
import { AGENT_UNEXPECTED_REASONING_TOKENS_EVENT } from "@cline/shared";
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
		return { echoed: input.text };
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

	it("fails a turn that hits the model output token limit before completion", async () => {
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const model = new ScriptedModel([
			() => [
				{ type: "reasoning-delta", text: "thinking..." },
				{ type: "finish", reason: "max-tokens" },
			],
		]);
		const runtime = new AgentRuntime({ model, logger });

		const result = await runtime.run("Hi");

		expect(result.status).toBe("failed");
		expect(result.error?.message).toContain("maximum output token limit");
		expect(model.requests).toHaveLength(1);
		expect(result.messages).toHaveLength(2);
		expect(result.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ type: "reasoning", text: "thinking..." }],
		});
		expect(logger.log).toHaveBeenCalledWith(
			"Agent loop caught error",
			expect.objectContaining({
				severity: "error",
				status: "failed",
				errorMessage: expect.stringContaining("maximum output token limit"),
				iteration: 1,
				assistantContentPartCount: 1,
			}),
		);
		expect(logger.error).toHaveBeenCalledWith(
			"Agent run failed",
			expect.objectContaining({
				error: expect.objectContaining({
					message: expect.stringContaining("maximum output token limit"),
				}),
			}),
		);
	});

	it("does not persist an empty assistant message when the model stream fails", async () => {
		const model = new ScriptedModel([
			() => [{ type: "finish", reason: "error", error: "upstream failed" }],
		]);
		const addedMessages: AgentMessage[] = [];
		const runtime = new AgentRuntime({ model });
		runtime.subscribe((event) => {
			if (event.type === "message-added") {
				addedMessages.push(event.message);
			}
		});

		const result = await runtime.run("Hi");

		expect(result.status).toBe("failed");
		expect(result.error?.message).toBe("upstream failed");
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("user");
		expect(addedMessages.map((message) => message.role)).toEqual(["user"]);
	});

	it("does not complete or persist history when the model returns no content", async () => {
		const model = new ScriptedModel([
			() => [{ type: "finish", reason: "stop" }],
		]);
		const runtime = new AgentRuntime({ model });

		const result = await runtime.run("Hi");

		expect(result.status).toBe("failed");
		expect(result.error?.message).toBe("Model returned empty response");
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("user");
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

	it("injects a pending user message after tool results and before the next model request", async () => {
		const consumePendingUserMessage = vi.fn(() => "steer now");
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
				const assistantMessage = request.messages.at(-3);
				const toolMessage = request.messages.at(-2);
				const steerMessage = request.messages.at(-1);
				expect(assistantMessage?.role).toBe("assistant");
				expect(
					assistantMessage?.content.some((part) => part.type === "tool-call"),
				).toBe(true);
				expect(toolMessage?.role).toBe("tool");
				expect(toolMessage?.content).toEqual([
					expect.objectContaining({
						type: "tool-result",
						toolCallId: "call_1",
					}),
				]);
				expect(steerMessage).toMatchObject({
					role: "user",
					content: [{ type: "text", text: "steer now" }],
				});
				return [
					{ type: "text-delta", text: "steered done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const addedMessages: AgentMessage[] = [];
		const runtime = new AgentRuntime({
			model,
			tools: [createEchoTool()],
			consumePendingUserMessage,
		});
		runtime.subscribe((event) => {
			if (event.type === "message-added") {
				addedMessages.push(event.message);
			}
		});

		const result = await runtime.run("Start");

		expect(consumePendingUserMessage).toHaveBeenCalledTimes(1);
		expect(model.requests).toHaveLength(2);
		expect(result.status).toBe("completed");
		expect(result.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"user",
			"assistant",
		]);
		expect(
			addedMessages.some(
				(message) =>
					message.role === "user" &&
					message.content.some(
						(part) => part.type === "text" && part.text === "steer now",
					),
			),
		).toBe(true);
	});

	it("injects pending user messages before prepareTurn projects the provider request", async () => {
		const consumePendingUserMessage = vi.fn(() => "steer before prepare");
		const prepareTurn = vi.fn(
			(context: { messages: readonly AgentMessage[] }) => ({
				messages: context.messages.slice(),
			}),
		);
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
				expect(request.messages.at(-1)).toMatchObject({
					role: "user",
					content: [{ type: "text", text: "steer before prepare" }],
				});
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEchoTool()],
			prepareTurn,
			consumePendingUserMessage,
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(prepareTurn).toHaveBeenCalledTimes(2);
		expect(consumePendingUserMessage).toHaveBeenCalledTimes(1);
		expect(result.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"user",
			"assistant",
		]);
		const secondPrepareMessages = prepareTurn.mock.calls[1]?.[0].messages;
		expect(secondPrepareMessages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "steer before prepare" }],
		});
	});

	it("lets prepareTurn project tool results after pending user input is added", async () => {
		const consumePendingUserMessage = vi.fn(() => "latest steering");
		const hugeToolOutput = "x".repeat(100_000);
		const prepareTurn = vi.fn(
			(context: { messages: readonly AgentMessage[] }) => {
				const latest = context.messages.at(-1);
				if (
					latest?.role === "user" &&
					latest.content.some(
						(part) => part.type === "text" && part.text === "latest steering",
					)
				) {
					return {
						messages: context.messages.filter(
							(message) => message.role !== "tool",
						),
					};
				}
				return { messages: context.messages.slice() };
			},
		);
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_large",
					toolName: "large",
					inputText: "{}",
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				expect(JSON.stringify(request.messages)).not.toContain(hugeToolOutput);
				expect(request.messages.at(-1)).toMatchObject({
					role: "user",
					content: [{ type: "text", text: "latest steering" }],
				});
				return [
					{ type: "text-delta", text: "compacted" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [
				{
					name: "large",
					description: "Large output",
					inputSchema: { type: "object" },
					execute: async () => hugeToolOutput,
				},
			],
			prepareTurn,
			consumePendingUserMessage,
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("compacted");
		expect(prepareTurn).toHaveBeenCalledTimes(2);
		const secondPrepareMessages = prepareTurn.mock.calls[1]?.[0].messages;
		expect(JSON.stringify(secondPrepareMessages)).toContain(hugeToolOutput);
		expect(secondPrepareMessages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "latest steering" }],
		});
	});

	it("continues when completionGuard rejects a no-tool response", async () => {
		const submitTool: AgentTool<{ summary: string }, string> = {
			name: "submit",
			description: "Submit final answer",
			inputSchema: { type: "object" },
			lifecycle: { completesRun: true },
			async execute(input) {
				return `submitted: ${input.summary}`;
			},
		};
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "I am done" },
				{ type: "finish", reason: "stop" },
			],
			(request) => {
				const reminder = request.messages.at(-1);
				expect(reminder?.role).toBe("user");
				expect(
					reminder?.content.some(
						(part) => part.type === "text" && part.text.includes("submit"),
					),
				).toBe(true);
				return [
					{
						type: "tool-call-delta",
						toolCallId: "call_submit",
						toolName: "submit",
						inputText: '{"summary":"done"}',
					},
					{ type: "finish", reason: "tool-calls" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [submitTool],
			completionPolicy: {
				completionGuard: () =>
					"[SYSTEM] This run is not complete until you call submit.",
			},
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(2);
		expect(result.outputText).toBe("submitted: done");
		expect(model.requests).toHaveLength(2);
	});

	it("announces and enforces required completion tools from tool lifecycle metadata", async () => {
		const submitTool: AgentTool<{ summary: string }, string> = {
			name: "custom_finish",
			description: "Submit final answer",
			inputSchema: { type: "object" },
			lifecycle: { completesRun: true },
			async execute(input) {
				return `submitted: ${input.summary}`;
			},
		};
		const model = new ScriptedModel([
			(request) => {
				const reminder = request.messages.at(-1);
				expect(reminder?.role).toBe("user");
				expect(
					reminder?.content.some(
						(part) =>
							part.type === "text" && part.text.includes("custom_finish"),
					),
				).toBe(true);
				return [
					{ type: "text-delta", text: "I am done" },
					{ type: "finish", reason: "stop" },
				];
			},
			(request) => {
				const reminder = request.messages.at(-1);
				expect(reminder?.role).toBe("user");
				expect(
					reminder?.content.some(
						(part) =>
							part.type === "text" && part.text.includes("custom_finish"),
					),
				).toBe(true);
				return [
					{
						type: "tool-call-delta",
						toolCallId: "call_submit",
						toolName: "custom_finish",
						inputText: '{"summary":"done"}',
					},
					{ type: "finish", reason: "tool-calls" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [submitTool],
			completionPolicy: { requireCompletionTool: true },
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(2);
		expect(result.outputText).toBe("submitted: done");
		expect(model.requests).toHaveLength(2);
	});

	it("finishes immediately after a successful terminal tool call", async () => {
		const submitTool: AgentTool<{ summary: string }, string> = {
			name: "submit",
			description: "Submit final answer",
			inputSchema: { type: "object" },
			lifecycle: { completesRun: true },
			async execute(input) {
				return input.summary;
			},
		};
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_submit",
					toolName: "submit",
					inputText: '{"summary":"finished"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [submitTool],
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.iterations).toBe(1);
		expect(result.outputText).toBe("finished");
		expect(model.requests).toHaveLength(1);
	});

	it("preserves structured multimodal tool results for the next model request", async () => {
		const structuredOutput = [
			{ type: "text", text: "Successfully read image" },
			{ type: "image", data: "QkFTRTY0REFUQQ==", mediaType: "image/jpeg" },
		];
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_img",
					toolName: "read_file",
					inputText: '{"path":"/tmp/image.jpg"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				expect(toolMessage.content[0]).toMatchObject({
					type: "tool-result",
					toolCallId: "call_img",
					toolName: "read_file",
					output: structuredOutput,
				});
				return [
					{ type: "text-delta", text: "saw image" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [
				{
					name: "read_file",
					description: "Read file",
					inputSchema: { type: "object" },
					execute: async () => structuredOutput,
				},
			],
		});

		const result = await runtime.run("Inspect image");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("saw image");
	});

	it("preserves plain tool outputs that contain an output property", async () => {
		const plainOutput = {
			output: "nested value",
			status: "ok",
			count: 2,
		};
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_plain",
					toolName: "plain_output",
					inputText: "{}",
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				expect(toolMessage.content[0]).toMatchObject({
					type: "tool-result",
					toolCallId: "call_plain",
					toolName: "plain_output",
					output: plainOutput,
				});
				return [
					{ type: "text-delta", text: "preserved" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [
				{
					name: "plain_output",
					description: "Return a plain object with an output key",
					inputSchema: { type: "object" },
					execute: async () => plainOutput,
				},
			],
		});

		const result = await runtime.run("Run tool");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("preserved");
	});

	it("requests approval when a tool policy disables auto-approval", async () => {
		const executeTool = vi.fn(async () => ({ echoed: "hi" }));
		const requestToolApproval = vi.fn(async () => ({
			approved: false,
			reason: "denied by test",
		}));
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_approval",
					toolName: "echo",
					inputText: '{"text":"hi"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				expect(toolMessage.content[0]).toMatchObject({
					type: "tool-result",
					isError: true,
					output: { error: "denied by test" },
				});
				return [
					{ type: "text-delta", text: "approval handled" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			sessionId: "session_test",
			agentId: "agent_test",
			conversationId: "conversation_test",
			model,
			tools: [
				{
					name: "echo",
					description: "Echo input text",
					inputSchema: { type: "object" },
					execute: executeTool,
				},
			],
			toolPolicies: { "*": { autoApprove: false } },
			requestToolApproval,
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("approval handled");
		expect(executeTool).not.toHaveBeenCalled();
		expect(requestToolApproval).toHaveBeenCalledWith({
			sessionId: "session_test",
			agentId: "agent_test",
			conversationId: "conversation_test",
			iteration: 1,
			toolCallId: "call_approval",
			toolName: "echo",
			input: { text: "hi" },
			policy: { autoApprove: false },
		});
	});

	it("applies beforeTool approval policy overrides before executing tools", async () => {
		const executeTool = vi.fn(async () => ({ echoed: "hi" }));
		const requestToolApproval = vi.fn(async () => ({
			approved: false,
			reason: "live policy denied",
		}));
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_live_policy",
					toolName: "echo",
					inputText: '{"text":"hi"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				expect(toolMessage.content[0]).toMatchObject({
					type: "tool-result",
					isError: true,
					output: { error: "live policy denied" },
				});
				return [
					{ type: "text-delta", text: "live policy handled" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			sessionId: "session_test",
			agentId: "agent_test",
			conversationId: "conversation_test",
			model,
			tools: [
				{
					name: "echo",
					description: "Echo input text",
					inputSchema: { type: "object" },
					execute: executeTool,
				},
			],
			toolPolicies: { "*": { autoApprove: true } },
			hooks: {
				beforeTool: () => ({ policy: { autoApprove: false } }),
			},
			requestToolApproval,
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("live policy handled");
		expect(executeTool).not.toHaveBeenCalled();
		expect(requestToolApproval).toHaveBeenCalledWith({
			sessionId: "session_test",
			agentId: "agent_test",
			conversationId: "conversation_test",
			iteration: 1,
			toolCallId: "call_live_policy",
			toolName: "echo",
			input: { text: "hi" },
			policy: { autoApprove: false },
		});
	});

	it("stores tool calls but skips execution when metadata disables external execution", async () => {
		const executeTool = vi.fn(async () => ({ echoed: "hi" }));
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

	it("normalizes JSON-encoded string fields when the tool schema expects arrays", async () => {
		const executeTool = vi.fn(async (input: { commands: string[] }) => ({
			joined: input.commands.join(" && "),
		}));
		const beforeTool = vi.fn();
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_commands",
					toolName: "commands",
					inputText: JSON.stringify({
						commands: JSON.stringify(["git status", "bun test"]),
					}),
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				expect(toolMessage.content[0]).toMatchObject({
					type: "tool-result",
					toolName: "commands",
					output: { joined: "git status && bun test" },
				});
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
					name: "commands",
					description: "Run commands",
					inputSchema: {
						type: "object",
						properties: {
							commands: {
								type: "array",
								items: { type: "string" },
							},
						},
					},
					execute: executeTool,
				},
			],
			hooks: {
				beforeTool,
			},
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(executeTool).toHaveBeenCalledWith(
			{ commands: ["git status", "bun test"] },
			expect.anything(),
		);
		expect(beforeTool).toHaveBeenCalledWith(
			expect.objectContaining({
				input: { commands: ["git status", "bun test"] },
				toolCall: expect.objectContaining({
					input: { commands: ["git status", "bun test"] },
				}),
			}),
		);
	});

	it("preserves JSON-looking strings when the tool schema expects strings", async () => {
		const executeTool = vi.fn(async (input: { text: string }) => ({
			echoed: input.text,
		}));
		const jsonText = JSON.stringify({ keep: "as text" });
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_text",
					toolName: "echo_json",
					inputText: JSON.stringify({ text: jsonText }),
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
			tools: [
				{
					name: "echo_json",
					description: "Echo JSON-looking text",
					inputSchema: {
						type: "object",
						properties: {
							text: { type: "string" },
						},
					},
					execute: executeTool,
				},
			],
		});

		const result = await runtime.run("Start");

		expect(result.status).toBe("completed");
		expect(executeTool).toHaveBeenCalledWith(
			{ text: jsonText },
			expect.anything(),
		);
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
						execute: async () => ({ ok: true }),
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

		const runtime = new AgentRuntime({
			model,
			conversationId: "conversation_plugin",
			plugins: [plugin],
		});
		const result = await runtime.run("Run plugin");

		expect(beforeRun).toHaveBeenCalledOnce();
		expect(beforeRun).toHaveBeenCalledWith({
			snapshot: expect.objectContaining({
				conversationId: "conversation_plugin",
			}),
		});
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
						reasoningTokenCount: 5,
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
			reasoningTokenCount: 5,
			cost: 0.42,
		});
	});

	it("captures telemetry when disabled reasoning still reports reasoning tokens", async () => {
		const telemetry = {
			capture: vi.fn(),
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateMetadata: vi.fn(),
			setCommonProperties: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as unknown as ITelemetryService;
		const model = new ScriptedModel([
			() => [
				{
					type: "usage",
					usage: {
						inputTokens: 12,
						outputTokens: 7,
						reasoningTokenCount: 5,
					},
				},
				{ type: "text-delta", text: "hello" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			modelOptions: { thinking: false },
			messageModelInfo: {
				id: "z-ai/glm-4.7",
				provider: "openrouter",
			},
			telemetry,
		});

		await runtime.run("Hi");

		expect(telemetry.capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: AGENT_UNEXPECTED_REASONING_TOKENS_EVENT,
				properties: expect.objectContaining({
					providerId: "openrouter",
					modelId: "z-ai/glm-4.7",
					requestedThinking: false,
					reasoningTokenCount: 5,
					iteration: 1,
				}),
			}),
		);
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

	it("projects the provider request without overwriting canonical messages", async () => {
		const projectedMessage: AgentMessage = {
			id: "msg_projected",
			role: "user",
			content: [{ type: "text", text: "projected context" }],
			createdAt: 1,
		};
		const notices: string[] = [];
		const prepareTurn = vi.fn((context) => {
			expect(context.messages).toHaveLength(1);
			expect(context.messages[0]?.content).toEqual([
				{ type: "text", text: "large context" },
			]);
			context.emitStatusNotice?.("auto-compacting", {
				reason: "auto_compaction",
			});
			return {
				messages: [projectedMessage],
				systemPrompt: "projected system",
			};
		});
		const beforeModel = vi.fn(({ request }) => {
			expect(request.systemPrompt).toBe("projected system");
			expect(request.messages).toEqual([projectedMessage]);
			return undefined;
		});
		const model = new ScriptedModel([
			(request) => {
				expect(request.systemPrompt).toBe("projected system");
				expect(request.messages).toEqual([projectedMessage]);
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			systemPrompt: "original system",
			prepareTurn,
			hooks: { beforeModel },
		});
		runtime.subscribe((event) => {
			if (event.type === "status-notice") {
				notices.push(event.message);
			}
		});

		const result = await runtime.run("large context");

		expect(prepareTurn).toHaveBeenCalledTimes(1);
		expect(beforeModel).toHaveBeenCalledTimes(1);
		expect(notices).toEqual(["auto-compacting"]);
		expect(model.requests[0]?.messages).toEqual([projectedMessage]);
		expect(result.messages[0]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "large context" }],
		});
		expect(result.messages).toHaveLength(2);
		expect(result.messages).not.toContainEqual(projectedMessage);
		expect(model.requests).toHaveLength(1);
	});

	it("merges beforeModel options metadata into the model request", async () => {
		const model = new ScriptedModel([
			(request) => {
				expect(request.options?.metadata).toMatchObject({
					sessionId: "session-1",
					runId: "run-1",
					iteration: 1,
				});
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			modelOptions: { metadata: { existing: true } },
			hooks: {
				beforeModel: () => ({
					options: {
						metadata: {
							sessionId: "session-1",
							runId: "run-1",
							iteration: 1,
						},
					},
				}),
			},
		});

		await runtime.run("capture metadata");

		expect(model.requests).toHaveLength(1);
		expect(model.requests[0]?.options?.metadata).toMatchObject({
			existing: true,
			sessionId: "session-1",
			runId: "run-1",
			iteration: 1,
		});
	});

	it("stamps runtime identity metadata onto model requests", async () => {
		const model = new ScriptedModel([
			(request) => {
				const metadata = request.options?.metadata as
					| Record<string, unknown>
					| undefined;
				expect(metadata).toMatchObject({
					sessionId: "session-runtime",
					agentId: "agent-runtime",
					conversationId: "conversation-runtime",
					iteration: 1,
				});
				expect(typeof metadata?.runId).toBe("string");
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			sessionId: "session-runtime",
			agentId: "agent-runtime",
			conversationId: "conversation-runtime",
			model,
		});

		await runtime.run("capture metadata");

		expect(model.requests).toHaveLength(1);
	});

	it("does not synthesize session or conversation ids in model request metadata", async () => {
		const model = new ScriptedModel([
			(request) => {
				const metadata = request.options?.metadata as
					| Record<string, unknown>
					| undefined;
				expect(metadata).not.toHaveProperty("sessionId");
				expect(metadata).not.toHaveProperty("conversationId");
				expect(metadata).toMatchObject({
					agentId: "agent-runtime",
					iteration: 1,
				});
				expect(typeof metadata?.runId).toBe("string");
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			agentId: "agent-runtime",
			model,
		});

		await runtime.run("capture metadata");

		expect(model.requests).toHaveLength(1);
	});

	it("preserves the existing system prompt when prepareTurn returns only messages", async () => {
		const projectedMessage: AgentMessage = {
			id: "msg_projected",
			role: "user",
			content: [{ type: "text", text: "projected context" }],
			createdAt: 1,
		};
		const model = new ScriptedModel([
			(request) => {
				expect(request.systemPrompt).toBe("original system");
				expect(request.messages).toEqual([projectedMessage]);
				return [
					{ type: "text-delta", text: "done" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({
			model,
			systemPrompt: "original system",
			prepareTurn: () => ({ messages: [projectedMessage] }),
		});

		await runtime.run("large context");

		expect(model.requests).toHaveLength(1);
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

	it("recovers when a model stream reports an invalid tool input error after a tool call", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "bad_json",
					toolName: "echo",
					inputText: '{"text": find /tmp | head -20}',
				},
				{
					type: "finish",
					reason: "error",
					error: "Invalid input for tool echo",
				},
			],
			(request) => {
				const toolMessage = request.messages.at(-1) as AgentMessage;
				expect(toolMessage.role).toBe("tool");
				expect(toolMessage.content[0]).toMatchObject({
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
		expect(
			result.messages.filter((message) => message.role === "tool"),
		).toHaveLength(1);
	});

	it("merges metadata from repeated tool-call deltas", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_with_metadata",
					toolName: "echo",
					inputText: '{"text":"hi"}',
					metadata: {
						thoughtSignature: "sig_123",
					},
				},
				{
					type: "tool-call-delta",
					toolCallId: "call_with_metadata",
					toolName: "echo",
					metadata: {
						inputParseError: "adapter rejected tool input",
					},
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				const assistantMessage = request.messages.find(
					(message) => message.role === "assistant",
				);
				const toolCall = assistantMessage?.content.find(
					(part) => part.type === "tool-call",
				);
				expect(toolCall).toMatchObject({
					type: "tool-call",
					metadata: {
						thoughtSignature: "sig_123",
						inputParseError: "adapter rejected tool input",
					},
				});
				const toolResult = request.messages.at(-1)?.content[0];
				expect(toolResult).toMatchObject({
					type: "tool-result",
					isError: true,
					output: {
						error: "adapter rejected tool input",
					},
				});
				return [
					{ type: "text-delta", text: "recovered" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const executeTool = vi.fn(async () => ({ echoed: "hi" }));
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
		expect(result.outputText).toBe("recovered");
		expect(executeTool).not.toHaveBeenCalled();
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
				return { name: "slow" };
			},
		};
		const fast: AgentTool = {
			name: "fast",
			description: "fast tool",
			inputSchema: { type: "object" },
			async execute() {
				executionOrder.push("fast-start");
				finishOrder.push("fast-finish");
				return { name: "fast" };
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
		const telemetry = {
			capture: vi.fn(),
			captureRequired: vi.fn(),
			setDistinctId: vi.fn(),
			setMetadata: vi.fn(),
			updateMetadata: vi.fn(),
			setCommonProperties: vi.fn(),
			updateCommonProperties: vi.fn(),
			isEnabled: () => true,
			recordCounter: vi.fn(),
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			flush: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
		} as unknown as ITelemetryService;
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
		expect(logger.log).toHaveBeenCalledWith(
			"Agent loop caught error",
			expect.objectContaining({
				severity: "error",
				status: "failed",
				errorMessage: "model failed",
			}),
		);
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

	it("resets usage between consecutive run/continue calls", async () => {
		const model = new ScriptedModel([
			() => [
				{
					type: "usage",
					usage: { inputTokens: 100, outputTokens: 20, totalCost: 0.5 },
				},
				{ type: "text-delta", text: "first" },
				{ type: "finish", reason: "stop" },
			],
			() => [
				{
					type: "usage",
					usage: { inputTokens: 200, outputTokens: 40, totalCost: 1.0 },
				},
				{ type: "text-delta", text: "second" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({ model });

		const first = await runtime.run("Turn 1");
		expect(first.usage).toMatchObject({
			inputTokens: 100,
			outputTokens: 20,
			totalCost: 0.5,
		});

		const second = await runtime.continue("Turn 2");
		expect(second.usage).toMatchObject({
			inputTokens: 200,
			outputTokens: 40,
			totalCost: 1.0,
		});
	});

	it("recovers a tool call from inline XML markup emitted in text-delta chunks (cline#9848)", async () => {
		// Models fronted by transports that do not relay native tool_use
		// blocks (e.g. some OpenAI-compatible gateways) emit tool
		// invocations as inline XML in the assistant text. The runtime
		// must parse those into proper tool-call events and execute them.
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "Let me echo that. " },
				{ type: "text-delta", text: '<invoke name="echo">' },
				{ type: "text-delta", text: '<parameter name="text">hi</parameter>' },
				{ type: "text-delta", text: "</invoke>" },
				{ type: "finish", reason: "tool-calls" },
			],
			() => [
				{ type: "text-delta", text: "done" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [createEchoTool()],
		});

		const result = await runtime.run("Hi");

		expect(result.status).toBe("completed");
		const toolMessage = result.messages.find((m) => m.role === "tool");
		expect(toolMessage).toBeDefined();
		const toolResult = toolMessage?.content.find(
			(c) => c.type === "tool-result",
		);
		expect(toolResult).toMatchObject({
			type: "tool-result",
			toolName: "echo",
		});
		// The recovered tool call should not leak the XML markup into the
		// final assistant transcript as plain text.
		const assistantMessages = result.messages.filter(
			(m) => m.role === "assistant",
		);
		const assistantText = assistantMessages
			.flatMap((m) => m.content)
			.filter((c) => c.type === "text")
			.map((c) => (c as { type: "text"; text: string }).text)
			.join("");
		expect(assistantText).not.toContain("<invoke");
		expect(assistantText).not.toContain("</invoke>");
	});

	it("treats malformed XML in text-delta chunks as plain text", async () => {
		// A <invoke> tag with no `name="..."` attribute must not be turned
		// into a tool call. The runtime should pass the markup through to
		// the assistant message as text.
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "Oops " },
				{ type: "text-delta", text: "<invoke>missing name</invoke>" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({ model });

		const result = await runtime.run("Hi");

		expect(result.status).toBe("completed");
		const assistant = result.messages.find((m) => m.role === "assistant");
		expect(assistant?.content.some((c) => c.type === "tool-call")).toBe(false);
		const text = assistant?.content
			.filter((c) => c.type === "text")
			.map((c) => (c as { type: "text"; text: string }).text)
			.join("");
		expect(text).toContain("<invoke>");
	});

	it("emits assistant-text-delta for text released by the tool-call parser flush", async () => {
		// Regression: when the model stream ends mid-markup (last delta ends
		// with '<inv'), the parser flushes the held-back tail as text. The
		// flush path must fire assistant-text-delta so subscribers that
		// accumulate text from those events see the full transcript —
		// without it, the final characters appear in the message but were
		// silently skipped during the stream.
		const model = new ScriptedModel([
			() => [
				{ type: "text-delta", text: "Hello " },
				{ type: "text-delta", text: "world" },
				{ type: "text-delta", text: "<inv" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({ model });

		const textDeltas: Array<{
			text: string;
			accumulatedText: string;
		}> = [];
		runtime.subscribe((event) => {
			if (event.type === "assistant-text-delta") {
				textDeltas.push({
					text: event.text,
					accumulatedText: event.accumulatedText,
				});
			}
		});

		const result = await runtime.run("Hi");

		expect(result.status).toBe("completed");
		// One delta per inline text piece plus one for the flushed tail.
		expect(textDeltas.map((d) => d.text)).toEqual(["Hello ", "world", "<inv"]);
		// Each accumulatedText includes the current piece plus everything
		// that came before it — including the flushed tail.
		expect(textDeltas.map((d) => d.accumulatedText)).toEqual([
			"Hello ",
			"Hello world",
			"Hello world<inv",
		]);
	});
});
