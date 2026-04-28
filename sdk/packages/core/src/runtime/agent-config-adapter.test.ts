/**
 * Unit tests for the `agent-config-adapter` pure adapter functions.
 *
 * Covers each of the four public direction-pairs:
 *
 *   1. `apiHandlerToAgentModel` — builds an `AgentModel` around an
 *      `ApiHandler`; `apiStreamChunkToAgentModelEvent` maps every
 *      `ApiStreamChunk` variant.
 *   2. `toolsToAgentTools` — adapts `Tool[]` → `AgentTool[]`;
 *      verifies the `ToolContext` → `AgentToolContext` wiring and
 *      the happy/error paths.
 *   3. `messagesToAgentMessages` / `agentMessageToMessageWithMetadata`
 *      / `agentMessagesToMessages` — the three message-shape
 *      adapters.
 *
 * Landed with PLAN.md Step 8c.
 */

import type { ApiHandler, ApiStreamChunk } from "@clinebot/llms";
import type {
	AgentMessage,
	AgentToolContext,
	ContentBlock,
	Message,
	MessageWithMetadata,
	Tool,
	ToolDefinition,
} from "@clinebot/shared";

// Local alias: the `ApiStream` type (async generator with id) is
// intentionally not re-exported by `@clinebot/llms`'s barrel; we
// reconstruct it locally via the handler's return type.
type ApiStream = ReturnType<ApiHandler["createMessage"]>;

import { describe, expect, it, vi } from "vitest";
import {
	agentMessagesToMessages,
	agentMessagesToMessagesWithMetadata,
	agentMessageToMessageWithMetadata,
	agentToolDefinitionsToToolDefinitions,
	apiHandlerToAgentModel,
	apiStreamChunkToAgentModelEvent,
	messagesToAgentMessages,
	messageToAgentMessages,
	toolsToAgentTools,
	toolToAgentTool,
	translateApiStream,
} from "./agent-config-adapter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function asApiStream(chunks: ApiStreamChunk[]): ApiStream {
	const iter = (async function* () {
		for (const chunk of chunks) {
			yield chunk;
		}
	})();
	return iter as ApiStream;
}

function makeAgentToolContext(
	overrides: Partial<AgentToolContext> = {},
): AgentToolContext {
	return {
		agentId: "agent_1",
		runId: "run_1",
		iteration: 1,
		toolCallId: "call_1",
		snapshot: {
			agentId: "agent_1",
			status: "running",
			iteration: 1,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
		},
		emitUpdate: () => undefined,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// apiStreamChunkToAgentModelEvent
// ---------------------------------------------------------------------------

describe("apiStreamChunkToAgentModelEvent", () => {
	it("maps text chunks to text-delta events", () => {
		expect(
			apiStreamChunkToAgentModelEvent({
				type: "text",
				id: "r1",
				text: "hello",
			}),
		).toEqual({ type: "text-delta", text: "hello" });
	});

	it("maps reasoning chunks with signature/redaction", () => {
		const event = apiStreamChunkToAgentModelEvent({
			type: "reasoning",
			id: "r1",
			reasoning: "let me think",
			signature: "sig-1",
			redacted_data: "xxx",
		});
		expect(event).toEqual({
			type: "reasoning-delta",
			text: "let me think",
			redacted: true,
			metadata: { signature: "sig-1" },
		});
	});

	it("maps tool_calls with string arguments", () => {
		const event = apiStreamChunkToAgentModelEvent({
			type: "tool_calls",
			id: "r1",
			tool_call: {
				call_id: "call-a",
				function: {
					id: "call-a",
					name: "read_file",
					arguments: '{"path":"/tmp/x"}',
				},
			},
			signature: "thought-sig",
		});
		expect(event).toMatchObject({
			type: "tool-call-delta",
			toolCallId: "call-a",
			toolName: "read_file",
			inputText: '{"path":"/tmp/x"}',
			metadata: { thoughtSignature: "thought-sig" },
		});
	});

	it("maps usage chunks", () => {
		expect(
			apiStreamChunkToAgentModelEvent({
				type: "usage",
				id: "r1",
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: 1,
				cacheWriteTokens: 2,
				totalCost: 0.5,
			}),
		).toEqual({
			type: "usage",
			usage: {
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: 1,
				cacheWriteTokens: 2,
				totalCost: 0.5,
			},
		});
	});

	it("maps done:success to finish(stop)", () => {
		expect(
			apiStreamChunkToAgentModelEvent({
				type: "done",
				id: "r1",
				success: true,
			}),
		).toEqual({ type: "finish", reason: "stop" });
	});

	it("maps done:success=false to finish(error)", () => {
		expect(
			apiStreamChunkToAgentModelEvent({
				type: "done",
				id: "r1",
				success: false,
				error: "oops",
			}),
		).toEqual({ type: "finish", reason: "error", error: "oops" });
	});

	it("maps done:max_tokens to finish(max-tokens)", () => {
		expect(
			apiStreamChunkToAgentModelEvent({
				type: "done",
				id: "r1",
				success: true,
				incompleteReason: "max_tokens",
			}),
		).toEqual({ type: "finish", reason: "max-tokens" });
	});
});

// ---------------------------------------------------------------------------
// translateApiStream / apiHandlerToAgentModel
// ---------------------------------------------------------------------------

describe("translateApiStream", () => {
	it("yields events and appends a synthetic finish when the stream ends without done", async () => {
		const stream = asApiStream([
			{ type: "text", id: "r1", text: "a" },
			{ type: "text", id: "r1", text: "b" },
		]);
		const events: unknown[] = [];
		for await (const ev of translateApiStream(stream)) {
			events.push(ev);
		}
		expect(events).toEqual([
			{ type: "text-delta", text: "a" },
			{ type: "text-delta", text: "b" },
			{ type: "finish", reason: "stop" },
		]);
	});

	it("emits a finish(error) when the stream throws", async () => {
		const stream = (async function* (): AsyncIterable<ApiStreamChunk> {
			yield { type: "text", id: "r1", text: "a" };
			throw new Error("boom");
		})();
		const events: unknown[] = [];
		for await (const ev of translateApiStream(stream)) {
			events.push(ev);
		}
		expect(events).toEqual([
			{ type: "text-delta", text: "a" },
			{ type: "finish", reason: "error", error: "boom" },
		]);
	});
});

describe("apiHandlerToAgentModel", () => {
	it("forwards systemPrompt/messages/tools and streams AgentModelEvents", async () => {
		const createMessage = vi.fn<ApiHandler["createMessage"]>(() =>
			asApiStream([
				{ type: "text", id: "r1", text: "hi" },
				{ type: "done", id: "r1", success: true },
			]),
		);
		const handler: ApiHandler = {
			createMessage,
			getMessages: () => undefined,
			getModel: () => ({ id: "m", info: { id: "m", capabilities: [] } }),
		};
		const model = apiHandlerToAgentModel(handler);
		const stream = await model.stream({
			systemPrompt: "sp",
			messages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 1,
				},
			],
			tools: [
				{ name: "echo", description: "e", inputSchema: { type: "object" } },
			],
		});
		const events: unknown[] = [];
		for await (const ev of stream) {
			events.push(ev);
		}
		expect(events).toEqual([
			{ type: "text-delta", text: "hi" },
			{ type: "finish", reason: "stop" },
		]);
		expect(createMessage).toHaveBeenCalledTimes(1);
		const [sp, msgs, tools] = createMessage.mock.calls[0];
		expect(sp).toBe("sp");
		expect(msgs).toEqual([
			{ role: "user", content: [{ type: "text", text: "hi" }] },
		]);
		expect(tools).toEqual([
			{ name: "echo", description: "e", inputSchema: { type: "object" } },
		]);
	});

	it("installs the abort signal on the handler when provided", async () => {
		const setAbortSignal = vi.fn();
		const ac = new AbortController();
		const handler: ApiHandler = {
			createMessage: () =>
				asApiStream([{ type: "done", id: "r1", success: true }]),
			getMessages: () => undefined,
			getModel: () => ({ id: "m", info: { id: "m", capabilities: [] } }),
			setAbortSignal,
		};
		const model = apiHandlerToAgentModel(handler, {
			getAbortSignal: () => ac.signal,
		});
		const stream = await model.stream({
			messages: [],
			tools: [],
		});
		// Drain the stream so the iterator runs.
		for await (const _ of stream) {
			/* no-op */
		}
		expect(setAbortSignal).toHaveBeenCalledWith(ac.signal);
	});

	it("prepares messages before invoking the handler", async () => {
		const createMessage = vi.fn<ApiHandler["createMessage"]>(() =>
			asApiStream([{ type: "done", id: "r1", success: true }]),
		);
		const handler: ApiHandler = {
			createMessage,
			getMessages: () => undefined,
			getModel: () => ({ id: "m", info: { id: "m", capabilities: [] } }),
		};
		const prepareMessages = vi.fn((messages: Message[]): Message[] => [
			...messages,
			{ role: "user", content: [{ type: "text", text: "prepared" }] },
		]);
		const model = apiHandlerToAgentModel(handler, { prepareMessages });

		const stream = await model.stream({
			messages: [
				{
					id: "m1",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 1,
				},
			],
			tools: [],
		});
		for await (const _ of stream) {
			/* no-op */
		}

		expect(prepareMessages).toHaveBeenCalledWith([
			{ role: "user", content: [{ type: "text", text: "hi" }] },
		]);
		expect(createMessage.mock.calls[0][1]).toEqual([
			{ role: "user", content: [{ type: "text", text: "hi" }] },
			{ role: "user", content: [{ type: "text", text: "prepared" }] },
		]);
	});
});

// ---------------------------------------------------------------------------
// toolsToAgentTools / toolToAgentTool
// ---------------------------------------------------------------------------

describe("toolToAgentTool", () => {
	it("carries name/description/inputSchema verbatim", () => {
		const tool: Tool<{ text: string }, { echoed: string }> = {
			name: "echo",
			description: "Echo input",
			inputSchema: { type: "object" },
			execute: async (input) => ({ echoed: input.text }),
		};
		const agentTool = toolToAgentTool(tool, { conversationId: "conv_1" });
		expect(agentTool.name).toBe(tool.name);
		expect(agentTool.description).toBe(tool.description);
		expect(agentTool.inputSchema).toBe(tool.inputSchema);
	});

	it("wraps execute with the legacy ToolContext shape and boxes the output", async () => {
		const executed = vi.fn(async (_input: { text: string }) => ({
			echoed: "hi",
		}));
		const tool: Tool<{ text: string }, { echoed: string }> = {
			name: "echo",
			description: "Echo input",
			inputSchema: { type: "object" },
			execute: executed,
		};
		const agentTool = toolToAgentTool(tool, {
			conversationId: "conv_1",
			metadata: { trace: "t1" },
		});
		const ctx = makeAgentToolContext();
		const result = await agentTool.execute({ text: "hi" }, ctx);
		expect(result).toEqual({ output: { echoed: "hi" } });
		expect(executed).toHaveBeenCalledTimes(1);
		const [, legacyCtx] = executed.mock.calls[0] as unknown as [
			unknown,
			{
				agentId: string;
				conversationId: string;
				iteration: number;
				metadata?: Record<string, unknown>;
			},
		];
		expect(legacyCtx.agentId).toBe("agent_1");
		expect(legacyCtx.conversationId).toBe("conv_1");
		expect(legacyCtx.iteration).toBe(1);
		expect(legacyCtx.metadata).toEqual({ trace: "t1" });
	});

	it("converts execute errors into AgentToolResult.isError", async () => {
		const tool: Tool<unknown, unknown> = {
			name: "bad",
			description: "always fails",
			inputSchema: { type: "object" },
			execute: async () => {
				throw new Error("nope");
			},
		};
		const agentTool = toolToAgentTool(tool, { conversationId: "c" });
		const result = await agentTool.execute({}, makeAgentToolContext());
		expect(result.isError).toBe(true);
		expect(result.output).toBe("nope");
	});
});

describe("toolsToAgentTools", () => {
	it("bulk-adapts", () => {
		const tools: Tool[] = [
			{
				name: "a",
				description: "a",
				inputSchema: {},
				execute: async () => ({}),
			},
			{
				name: "b",
				description: "b",
				inputSchema: {},
				execute: async () => ({}),
			},
		];
		const adapted = toolsToAgentTools(tools, { conversationId: "c" });
		expect(adapted).toHaveLength(2);
		expect(adapted.map((t) => t.name)).toEqual(["a", "b"]);
	});
});

describe("agentToolDefinitionsToToolDefinitions", () => {
	it("maps runtime definitions to legacy definitions", () => {
		const defs: ToolDefinition[] = agentToolDefinitionsToToolDefinitions([
			{ name: "x", description: "d", inputSchema: { type: "object" } },
		]);
		expect(defs).toEqual([
			{ name: "x", description: "d", inputSchema: { type: "object" } },
		]);
	});
});

// ---------------------------------------------------------------------------
// messagesToAgentMessages / agentMessageToMessageWithMetadata
// ---------------------------------------------------------------------------

describe("messageToAgentMessages", () => {
	it("maps a simple text user message", () => {
		const msg: MessageWithMetadata = {
			id: "m1",
			role: "user",
			content: "hello",
			ts: 1_000,
		};
		const out = messageToAgentMessages(msg);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			id: "m1",
			role: "user",
			createdAt: 1_000,
			content: [{ type: "text", text: "hello" }],
		});
	});

	it("splits a message with tool_result blocks into a user message + a tool message", () => {
		const msg: MessageWithMetadata = {
			id: "m1",
			role: "user",
			content: [
				{ type: "text", text: "hi" },
				{
					type: "tool_result",
					tool_use_id: "call-1",
					content: "result",
					is_error: false,
				},
			],
			ts: 1,
		};
		const out = messageToAgentMessages(msg);
		expect(out).toHaveLength(2);
		expect(out[0].role).toBe("user");
		expect(out[0].content).toEqual([{ type: "text", text: "hi" }]);
		expect(out[1].role).toBe("tool");
		expect(out[1].content).toEqual([
			{
				type: "tool-result",
				toolCallId: "call-1",
				toolName: "",
				output: "result",
				isError: false,
			},
		]);
	});

	it("maps thinking and tool_use blocks", () => {
		const msg: MessageWithMetadata = {
			id: "m2",
			role: "assistant",
			content: [
				{
					type: "thinking",
					thinking: "let me see",
					signature: "s1",
				},
				{
					type: "tool_use",
					id: "call-1",
					name: "read_file",
					input: { path: "/x" },
				},
			],
			ts: 2,
		};
		const out = messageToAgentMessages(msg);
		expect(out).toHaveLength(1);
		const parts = out[0].content;
		expect(parts[0]).toMatchObject({
			type: "reasoning",
			text: "let me see",
		});
		expect(parts[1]).toMatchObject({
			type: "tool-call",
			toolCallId: "call-1",
			toolName: "read_file",
			input: { path: "/x" },
		});
	});

	it("maps metrics/modelInfo across", () => {
		const msg: MessageWithMetadata = {
			id: "m3",
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			ts: 3,
			modelInfo: { id: "m", provider: "p", family: "f" },
			metrics: {
				inputTokens: 10,
				outputTokens: 20,
				cacheReadTokens: 1,
				cacheWriteTokens: 2,
				cost: 0.5,
			},
		};
		const out = messageToAgentMessages(msg);
		expect(out[0].modelInfo).toEqual({ id: "m", provider: "p", family: "f" });
		expect(out[0].metrics).toEqual({
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 1,
			cacheWriteTokens: 2,
			cost: 0.5,
		});
	});
});

describe("messagesToAgentMessages", () => {
	it("bulk-converts and flattens tool-result splits", () => {
		const messages: MessageWithMetadata[] = [
			{
				id: "m1",
				role: "user",
				content: [
					{ type: "text", text: "hi" },
					{
						type: "tool_result",
						tool_use_id: "call-1",
						content: "r",
					},
				],
			},
			{
				id: "m2",
				role: "assistant",
				content: "ok",
			},
		];
		const out = messagesToAgentMessages(messages);
		expect(out).toHaveLength(3);
		expect(out.map((m) => m.role)).toEqual(["user", "tool", "assistant"]);
	});
});

describe("agentMessageToMessageWithMetadata (round-trip)", () => {
	it("round-trips text messages", () => {
		const legacy: MessageWithMetadata = {
			id: "m1",
			role: "user",
			content: [{ type: "text", text: "hi" }],
			ts: 1_000,
		};
		const agent = messageToAgentMessages(legacy)[0];
		const back = agentMessageToMessageWithMetadata(agent);
		expect(back).toMatchObject({
			id: "m1",
			role: "user",
			ts: 1_000,
			content: [{ type: "text", text: "hi" }],
		});
	});

	it("maps tool-call parts back to tool_use blocks", () => {
		const agent: AgentMessage = {
			id: "m1",
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: "call-1",
					toolName: "read_file",
					input: { path: "/x" },
				},
			],
			createdAt: 1,
		};
		const back = agentMessageToMessageWithMetadata(agent);
		expect(Array.isArray(back.content)).toBe(true);
		const blocks = back.content as ContentBlock[];
		expect(blocks[0]).toEqual({
			type: "tool_use",
			id: "call-1",
			name: "read_file",
			input: { path: "/x" },
			signature: undefined,
		});
	});

	it("remaps tool-role messages to user-role legacy messages with tool_result blocks", () => {
		const agent: AgentMessage = {
			id: "m1_tool_call-1",
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "call-1",
					toolName: "read_file",
					output: "contents",
				},
			],
			createdAt: 1,
		};
		const back = agentMessageToMessageWithMetadata(agent);
		expect(back.role).toBe("user");
		const blocks = back.content as ContentBlock[];
		expect(blocks[0]).toEqual({
			type: "tool_result",
			tool_use_id: "call-1",
			content: "contents",
			is_error: undefined,
		});
	});
});

describe("agentMessagesToMessagesWithMetadata", () => {
	it("bulk-converts back", () => {
		const agent: AgentMessage[] = [
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 1,
			},
		];
		const back = agentMessagesToMessagesWithMetadata(agent);
		expect(back).toHaveLength(1);
		expect(back[0].role).toBe("user");
	});
});

describe("agentMessagesToMessages", () => {
	it("produces legacy Message[] suitable for ApiHandler.createMessage", () => {
		const agent: AgentMessage[] = [
			{
				id: "m1",
				role: "user",
				content: [{ type: "text", text: "hi" }],
				createdAt: 1,
			},
			{
				id: "m2",
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call-1",
						toolName: "read_file",
						output: "ok",
					},
				],
				createdAt: 2,
			},
		];
		const msgs: Message[] = agentMessagesToMessages(agent);
		expect(msgs).toHaveLength(2);
		// Tool-role agent messages are flattened back to user-role
		// with a tool_result content block.
		expect(msgs[1].role).toBe("user");
	});

	it("merges adjacent tool messages so multi-tool turns have complete results", () => {
		const agent: AgentMessage[] = [
			{
				id: "assistant",
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_text",
						toolName: "read_file",
						input: { path: "/tmp/a.txt" },
					},
					{
						type: "tool-call",
						toolCallId: "call_image",
						toolName: "read_file",
						input: { path: "/tmp/image.jpg" },
					},
				],
				createdAt: 1,
			},
			{
				id: "tool_text",
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_text",
						toolName: "read_file",
						output: "text contents",
					},
				],
				createdAt: 2,
			},
			{
				id: "tool_image",
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_image",
						toolName: "read_file",
						output: [
							{ type: "text", text: "Successfully read image" },
							{
								type: "image",
								data: "BASE64DATA",
								mediaType: "image/jpeg",
							},
						],
					},
				],
				createdAt: 3,
			},
		];

		const msgs = agentMessagesToMessages(agent);

		expect(msgs).toHaveLength(2);
		expect(msgs[1].role).toBe("user");
		expect(msgs[1].content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "call_text",
				content: "text contents",
				is_error: undefined,
			},
			{
				type: "tool_result",
				tool_use_id: "call_image",
				content: [
					{ type: "text", text: "Successfully read image" },
					{
						type: "image",
						data: "BASE64DATA",
						mediaType: "image/jpeg",
					},
				],
				is_error: undefined,
			},
		]);
	});
});
