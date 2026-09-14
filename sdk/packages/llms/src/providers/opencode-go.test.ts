import type { AgentModelEvent, AgentToolDefinition } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway } from "./gateway";

const tool: AgentToolDefinition = {
	name: "read_files",
	description: "Read files",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" } },
		required: ["path"],
	},
};

function sse(events: Record<string, unknown>[]) {
	return events
		.map(
			(event) =>
				`event: ${event.type ?? "message"}\ndata: ${JSON.stringify(event)}\n\n`,
		)
		.join("");
}

const chatResponse = `${sse([
	{
		id: "chat-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test",
		choices: [{ index: 0, delta: { content: "OK" }, finish_reason: null }],
	},
	{
		id: "chat-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test",
		choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
		usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
	},
])}data: [DONE]\n\n`;

const responsesResponse = sse([
	{
		type: "response.created",
		response: { id: "resp-1", created_at: 1, model: "test" },
	},
	{
		type: "response.output_item.added",
		output_index: 0,
		item: { type: "message", id: "msg-1", role: "assistant", content: [] },
	},
	{
		type: "response.output_text.delta",
		item_id: "msg-1",
		output_index: 0,
		content_index: 0,
		delta: "OK",
	},
	{
		type: "response.output_item.done",
		output_index: 0,
		item: {
			type: "message",
			id: "msg-1",
			role: "assistant",
			content: [{ type: "output_text", text: "OK", annotations: [] }],
		},
	},
	{
		type: "response.completed",
		response: {
			id: "resp-1",
			created_at: 1,
			model: "test",
			status: "completed",
			incomplete_details: null,
			usage: {
				input_tokens: 10,
				output_tokens: 1,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens_details: { reasoning_tokens: 0 },
			},
		},
	},
]);

const messagesResponse = sse([
	{
		type: "message_start",
		message: {
			id: "msg-1",
			type: "message",
			role: "assistant",
			model: "test",
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 0 },
		},
	},
	{
		type: "content_block_start",
		index: 0,
		content_block: { type: "text", text: "" },
	},
	{
		type: "content_block_delta",
		index: 0,
		delta: { type: "text_delta", text: "OK" },
	},
	{ type: "content_block_stop", index: 0 },
	{
		type: "message_delta",
		delta: { stop_reason: "end_turn", stop_sequence: null },
		usage: { output_tokens: 1 },
	},
	{ type: "message_stop" },
]);

describe("OpenCode Go HTTP integration", () => {
	it.each([
		["openai-compatible", { apiProtocol: "openai-responses" }],
		["opencode-go", {}],
		["opencode-go", { apiProtocol: "unknown" }],
	])("keeps chat routing without an opted-in known protocol (%s, %j)", async (providerId, metadata) => {
		const fetchMock = vi.fn(
			async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
				new Response(chatResponse, {
					headers: { "content-type": "text/event-stream" },
				}),
		);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId,
					apiKey: "test-key",
					baseUrl: "https://gateway.example/v1",
					models: [{ id: "test-model", name: "Test", metadata }],
					fetch: fetchMock as unknown as typeof fetch,
				},
			],
		});
		for await (const _event of await gateway.stream({
			providerId,
			modelId: "test-model",
			metadata: { sessionId: "test-session" },
			messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
		})) {
			/* Drain the real adapter stream. */
		}
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://gateway.example/v1/chat/completions",
		);
	});

	it("keeps a Go conversation header through Responses retries", async () => {
		const fetchMock = vi.fn(
			async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
				if (fetchMock.mock.calls.length === 1)
					return new Response(
						JSON.stringify({ error: { message: "temporarily unavailable" } }),
						{ status: 503, headers: { "content-type": "application/json" } },
					);
				return new Response(responsesResponse, {
					headers: { "content-type": "text/event-stream" },
				});
			},
		);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "opencode-go",
					apiKey: "test-key",
					fetch: fetchMock as unknown as typeof fetch,
				},
			],
		});
		const events: AgentModelEvent[] = [];
		for await (const event of await gateway.stream({
			providerId: "opencode-go",
			modelId: "muse-spark-1.3-contributor",
			metadata: { sessionId: "retry-session" },
			messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
		}))
			events.push(event);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "text-delta", text: "OK" }),
		);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const [, init] of fetchMock.mock.calls)
			expect(new Headers(init?.headers).get("x-opencode-session")).toBe(
				"retry-session",
			);
	});

	it.each([
		["glm-5.3", "chat/completions", chatResponse],
		["kimi-k2.6", "chat/completions", chatResponse],
		["muse-spark-1.3-contributor", "responses", responsesResponse],
		["muse-spark-1.2-contributor", "responses", responsesResponse],
		["minimax-m2.7", "messages", messagesResponse],
		["qwen3.7-plus", "messages", messagesResponse],
	])("routes %s with conversation headers, tools, and stream decoding", async (modelId, endpoint, response) => {
		const fetchMock = vi.fn(
			async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
				new Response(response, {
					headers: { "content-type": "text/event-stream" },
				}),
		);
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "opencode-go",
					apiKey: "test-key",
					fetch: fetchMock as unknown as typeof fetch,
				},
			],
		});
		for (const sessionId of [
			"conversation-a",
			"conversation-a",
			"conversation-b",
		]) {
			const events: AgentModelEvent[] = [];
			for await (const event of await gateway.stream({
				providerId: "opencode-go",
				modelId,
				metadata: { sessionId },
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "Inspect the project" }],
					},
				],
				tools: [tool],
			}))
				events.push(event);
			expect(events).toContainEqual(
				expect.objectContaining({ type: "text-delta", text: "OK" }),
			);
			expect(events).toContainEqual(
				expect.objectContaining({ type: "finish", reason: "stop" }),
			);
			const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
			expect(String(url)).toBe(`https://opencode.ai/zen/go/v1/${endpoint}`);
			const headers = new Headers(init?.headers);
			expect(headers.get("x-opencode-session")).toBe(sessionId);
			expect(headers.get("user-agent")).toContain("Cline/");
			expect(
				headers.get(endpoint === "messages" ? "x-api-key" : "authorization"),
			).toBe(endpoint === "messages" ? "test-key" : "Bearer test-key");
			const body = JSON.parse(String(init?.body));
			expect(body.model).toBe(modelId);
			expect(body.tools).toHaveLength(1);
			if (endpoint === "responses") {
				expect(body.input).toBeDefined();
				expect(body.messages).toBeUndefined();
				expect(body.tools[0].name).toBe("read_files");
			} else if (endpoint === "messages") {
				expect(body.tools[0].input_schema).toEqual(tool.inputSchema);
			} else {
				expect(body.tools[0].function.name).toBe("read_files");
			}
		}
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
