import { describe, expect, it, vi } from "vitest";
import type {
	ApiStreamChunk,
	Message,
	ProviderConfig,
	ToolDefinition,
} from "../providers";
import { createHandlerAsync } from "../providers";

// Exercise handler routing, option composition, and the AI SDK serializers.
// Mock only the HTTP boundary so the actual URL and wire format are checked.
describe("OpenAI-compatible API selection", () => {
	it.each([
		"minimal",
		"low",
		"medium",
		"high",
		"xhigh",
		"max",
	] as const)("sends exact %s effort for custom models on both APIs", async (effort) => {
		for (const responses of [false, true]) {
			const fetchMock = responses ? responsesFetch() : chatFetch();
			const chunks = await run(
				config({
					fetch: fetchMock,
					thinking: true,
					reasoningEffort: effort,
					...(responses ? { routingProviderId: "openai-native" } : {}),
				}),
			);
			const body = requestBody(fetchMock);
			if (responses) {
				expect(body.reasoning).toEqual({ effort });
				expect(body).not.toHaveProperty("reasoning_effort");
			} else {
				expect(body.reasoning_effort).toBe(effort);
			}
			expect(chunks).toContainEqual(
				expect.objectContaining({ type: "done", success: true }),
			);
		}
	});

	it("distinguishes explicit off from provider default for custom models on both APIs", async () => {
		for (const responses of [false, true]) {
			for (const thinking of [undefined, false]) {
				const fetchMock = responses ? responsesFetch() : chatFetch();
				await run(
					config({
						fetch: fetchMock,
						thinking,
						...(responses ? { routingProviderId: "openai-native" } : {}),
					}),
				);
				const body = requestBody(fetchMock);
				if (thinking === undefined) {
					expect(body).not.toHaveProperty("reasoning");
					expect(body).not.toHaveProperty("reasoning_effort");
				} else if (responses) {
					expect(body.reasoning).toEqual({ effort: "none" });
				} else {
					expect(body.reasoning_effort).toBe("none");
				}
			}
		}
	});

	it("respects advertised effort values and explicit no-control metadata", async () => {
		for (const responses of [false, true]) {
			for (const reasoningOptions of [
				[
					{
						type: "effort" as const,
						values: ["low" as const, "high" as const],
					},
				],
				[],
			]) {
				const fetchMock = responses ? responsesFetch() : chatFetch();
				await run(
					config({
						fetch: fetchMock,
						thinking: true,
						reasoningEffort: "medium",
						knownModels: {
							"custom-model": { id: "custom-model", reasoningOptions },
						},
						...(responses ? { routingProviderId: "openai-native" } : {}),
					}),
				);
				const body = requestBody(fetchMock);
				if (reasoningOptions.length === 0) {
					expect(body).not.toHaveProperty("reasoning");
					expect(body).not.toHaveProperty("reasoning_effort");
				} else if (responses) {
					expect(body.reasoning).toEqual({ effort: "high" });
				} else {
					expect(body.reasoning_effort).toBe("high");
				}
			}
		}
	});
	it("uses Chat Completions for existing configurations", async () => {
		const fetchMock = chatFetch();
		const chunks = await run(config({ fetch: fetchMock }));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://proxy.example/v1/chat/completions",
		);
		expect(requestBody(fetchMock)).toMatchObject({
			model: "custom-model",
			messages: expect.any(Array),
			stream: true,
		});
		expect(requestBody(fetchMock)).not.toHaveProperty("input");
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "text", text: "OK" }),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "done", success: true }),
		);
	});

	it("uses Responses with custom model IDs, credentials, headers, and explicit token limits", async () => {
		const fetchMock = responsesFetch();
		const chunks = await run(
			config({
				routingProviderId: "openai-native",
				clientType: "openai",
				fetch: fetchMock,
				maxOutputTokens: 512,
				headers: { "x-custom-header": "custom" },
			}),
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
			"https://proxy.example/v1/responses",
		);
		expect(requestBody(fetchMock)).toMatchObject({
			model: "custom-model",
			input: expect.any(Array),
			max_output_tokens: 512,
			stream: true,
			store: false,
		});
		expect(requestBody(fetchMock)).not.toHaveProperty("messages");
		expect(requestBody(fetchMock)).not.toHaveProperty("max_tokens");
		const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
		expect(headers.get("authorization")).toBe("Bearer test-key");
		expect(headers.get("x-custom-header")).toBe("custom");
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "text", text: "OK" }),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "done", success: true }),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "usage",
				inputTokens: 3,
				outputTokens: 2,
			}),
		);
	});

	it("preserves tool call history and streams function calls", async () => {
		const fetchMock = responsesFetch([
			{
				type: "response.output_item.added",
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_next",
					call_id: "call_next",
					name: "read_file",
					arguments: "",
				},
			},
			{
				type: "response.function_call_arguments.delta",
				item_id: "fc_next",
				output_index: 0,
				delta: '{"path":"next.txt"}',
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "function_call",
					id: "fc_next",
					call_id: "call_next",
					name: "read_file",
					arguments: '{"path":"next.txt"}',
					status: "completed",
				},
			},
		]);
		const messages: Message[] = [
			{ role: "user", content: "Read a.txt" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_previous",
						name: "read_file",
						input: { path: "a.txt" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_previous",
						content: "File contents",
					},
				],
			},
		];
		const tools: ToolDefinition[] = [
			{
				name: "read_file",
				description: "Read a file",
				inputSchema: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			},
		];
		const chunks = await run(
			config({ routingProviderId: "openai-native", fetch: fetchMock }),
			messages,
			tools,
		);
		expect(requestBody(fetchMock).input).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "function_call",
					call_id: "call_previous",
					name: "read_file",
					arguments: '{"path":"a.txt"}',
				}),
				expect.objectContaining({
					type: "function_call_output",
					call_id: "call_previous",
					output: "File contents",
				}),
			]),
		);
		expect(requestBody(fetchMock).tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "function",
					name: "read_file",
					parameters: tools[0]?.inputSchema,
				}),
			]),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "tool_calls",
				tool_call: expect.objectContaining({
					call_id: "call_next",
					function: expect.objectContaining({ name: "read_file" }),
				}),
			}),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "done", success: true }),
		);
	});

	it("streams Responses reasoning alongside text", async () => {
		const fetchMock = responsesFetch([
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "reasoning", id: "rs_test" },
			},
			{
				type: "response.reasoning_summary_part.added",
				item_id: "rs_test",
				output_index: 0,
				summary_index: 0,
			},
			{
				type: "response.reasoning_summary_text.delta",
				item_id: "rs_test",
				output_index: 0,
				summary_index: 0,
				delta: "Thinking about the answer",
			},
			{
				type: "response.reasoning_summary_part.done",
				item_id: "rs_test",
				output_index: 0,
				summary_index: 0,
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "reasoning",
					id: "rs_test",
					encrypted_content: "encrypted-reasoning",
				},
			},
			{
				type: "response.output_item.added",
				output_index: 1,
				item: { type: "message", id: "msg_test" },
			},
			{
				type: "response.output_text.delta",
				item_id: "msg_test",
				output_index: 1,
				delta: "OK",
			},
			{
				type: "response.output_item.done",
				output_index: 1,
				item: { type: "message", id: "msg_test" },
			},
		]);
		const chunks = await run(
			config({ routingProviderId: "openai-native", fetch: fetchMock }),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({
				type: "reasoning",
				reasoning: "Thinking about the answer",
			}),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "text", text: "OK" }),
		);
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "done", success: true }),
		);
	});

	it("forwards the Azure deployment API version for Responses", async () => {
		const fetchMock = responsesFetch();
		await run(
			config({
				routingProviderId: "openai-native",
				baseUrl: "https://azure.example/openai/deployments/custom",
				azure: { apiVersion: "2025-04-01-preview" },
				fetch: fetchMock,
			}),
		);
		const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
		expect(url.pathname).toBe("/openai/deployments/custom/responses");
		expect(url.searchParams.get("api-version")).toBe("2025-04-01-preview");
	});

	it("permits keyless local Responses endpoints and preserves custom authentication headers", async () => {
		for (const headers of [
			undefined,
			{ Authorization: "Bearer custom-auth" },
		]) {
			const fetchMock = responsesFetch();
			const chunks = await run(
				config({
					routingProviderId: "openai-native",
					apiKey: undefined,
					headers,
					fetch: fetchMock,
				}),
			);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(
				new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
			).toBe(headers?.Authorization ?? null);
			expect(chunks).toContainEqual(
				expect.objectContaining({ type: "done", success: true }),
			);
		}
	});
});

function config(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
	return {
		providerId: "openai-compatible",
		modelId: "custom-model",
		apiKey: "test-key",
		baseUrl: "https://proxy.example/v1",
		...overrides,
	};
}

async function run(
	providerConfig: ProviderConfig,
	messages: Message[] = [{ role: "user", content: "Say OK" }],
	tools?: ToolDefinition[],
) {
	const handler = await createHandlerAsync(providerConfig);
	const chunks: ApiStreamChunk[] = [];
	for await (const chunk of handler.createMessage(
		"Be helpful",
		messages,
		tools,
	))
		chunks.push(chunk);
	return chunks;
}

function responsesFetch(
	outputEvents = [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "msg_test" },
		},
		{
			type: "response.output_text.delta",
			item_id: "msg_test",
			output_index: 0,
			delta: "OK",
		},
		{
			type: "response.output_item.done",
			output_index: 0,
			item: { type: "message", id: "msg_test" },
		},
	] as Record<string, unknown>[],
) {
	const events = [
		{
			type: "response.created",
			response: { id: "resp_test", created_at: 0, model: "custom-model" },
		},
		...outputEvents,
		{
			type: "response.completed",
			response: { usage: { input_tokens: 3, output_tokens: 2 } },
		},
	];
	return vi.fn<typeof fetch>(
		async () =>
			new Response(
				events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
				{ headers: { "content-type": "text/event-stream" } },
			),
	);
}

function chatFetch() {
	return vi.fn<typeof fetch>(
		async () =>
			new Response(
				`data: ${JSON.stringify({
					id: "chatcmpl_test",
					created: 0,
					model: "custom-model",
					choices: [
						{ index: 0, delta: { content: "OK" }, finish_reason: "stop" },
					],
					usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
				})}\n\ndata: [DONE]\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			),
	);
}

function requestBody(
	fetchMock: ReturnType<typeof responsesFetch>,
): Record<string, unknown> {
	return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<
		string,
		unknown
	>;
}
