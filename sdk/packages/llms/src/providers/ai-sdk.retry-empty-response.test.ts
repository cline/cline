import type {
	LanguageModelV4,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
	LanguageModelV4Usage,
} from "@ai-sdk/provider";
import type {
	AgentModelEvent,
	AgentToolDefinition,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createAnthropicProvider,
	createClineProvider,
	createOllamaProvider,
	createOpenAICompatibleProvider,
	normalizeUsage,
	withEmptyResponseRetry,
} from "./ai-sdk";

/**
 * Integration tests proving `createRetryEmptyResponseMiddleware` is engaged
 * for every AI SDK vendor via the central wrap in `createAiSdkProvider`
 * (`withEmptyResponseRetry`), not just Ollama.
 *
 * Production telemetry (2026-08-02→03) showed `Model returned empty response`
 * hard failures on openrouter, cline, and generic OpenAI-compatible
 * endpoints — 46 tasks / 120 events in 24h on the SDK extension. These tests
 * drive the real adapter + real `ai` package with fake wire responses (SSE
 * for the OpenAI-compatible and Anthropic wire formats) so the vendor's
 * actual stream-part shapes are exercised, guarding against a vendor whose
 * parts differ in shape being retried incorrectly (e.g. a tool-call-only
 * turn, which must never be retried because Cline runs its own tool loop).
 */

const READ_FILES_TOOL: AgentToolDefinition = {
	name: "read_files",
	description: "Read files",
	inputSchema: {
		type: "object",
		properties: {
			files: { type: "array", items: { type: "string" } },
		},
		required: ["files"],
	},
};

function queuedFetch(bodies: string[]) {
	let call = 0;
	return vi.fn(
		async () =>
			new Response(bodies[Math.min(call++, bodies.length - 1)], {
				status: 200,
				headers: {
					"content-type": "text/event-stream",
					"X-Request-ID": `request-${call}`,
				},
			}),
	);
}

async function collect(
	iterable: AsyncIterable<AgentModelEvent>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
}

function streamRequest(
	tools: AgentToolDefinition[] = [],
): GatewayStreamRequest {
	return {
		providerId: "test",
		modelId: "test-model",
		messages: [
			{
				id: "msg_user",
				role: "user",
				content: [{ type: "text", text: "do the thing" }],
				createdAt: new Date(),
			},
		],
		tools,
	} as unknown as GatewayStreamRequest;
}

function providerContext(
	providerId: string,
	config: Record<string, unknown>,
	pricing?: Record<string, number>,
): GatewayProviderContext {
	const model = {
		id: "test-model",
		providerId,
		name: "test-model",
		...(pricing ? { metadata: { pricing } } : {}),
	};
	return {
		provider: {
			id: providerId,
			name: providerId,
			defaultModelId: "test-model",
			models: [model],
		},
		model,
		config,
	} as unknown as GatewayProviderContext;
}

function hasTextDelta(events: AgentModelEvent[], text: string): boolean {
	return events.some(
		(event) => event.type === "text-delta" && event.text.includes(text),
	);
}

function finishEvents(events: AgentModelEvent[]) {
	return events.filter((event) => event.type === "finish");
}

describe("openai-compatible wire format (openrouter / cline / custom endpoints)", () => {
	const chunk = (delta: unknown, finish: string | null = null) =>
		`data: ${JSON.stringify({
			id: "cmpl-1",
			object: "chat.completion.chunk",
			created: 1,
			model: "test-model",
			choices: [{ index: 0, delta, finish_reason: finish }],
		})}\n\n`;

	const emptySse =
		chunk({ role: "assistant", content: "" }) +
		chunk({}, "stop") +
		"data: [DONE]\n\n";
	const textSse =
		chunk({ role: "assistant", content: "hello" }) +
		chunk({}, "stop") +
		"data: [DONE]\n\n";
	const toolCallSse =
		chunk({
			role: "assistant",
			tool_calls: [
				{
					index: 0,
					id: "call_1",
					type: "function",
					function: { name: "read_files", arguments: '{"files":["a.ts"]}' },
				},
			],
		}) +
		chunk({}, "tool_calls") +
		"data: [DONE]\n\n";

	async function run(
		bodies: string[],
		tools: AgentToolDefinition[] = [],
		pricing?: Record<string, number>,
	) {
		const fetchMock = queuedFetch(bodies);
		const config = {
			providerId: "openai-compatible",
			apiKey: "test-key",
			baseUrl: "http://fake.local/v1",
			fetch: fetchMock as unknown as typeof fetch,
		};
		const provider = await createOpenAICompatibleProvider(config);
		const events = await collect(
			await provider.stream(
				streamRequest(tools),
				providerContext("openai-compatible", config, pricing),
			),
		);
		return { fetchMock, events };
	}

	function responseWithUsage(text: string, usage: Record<string, unknown>) {
		return (
			chunk({ role: "assistant", content: text }) +
			chunk({}, "stop") +
			`data: ${JSON.stringify({
				id: "cmpl-1",
				object: "chat.completion.chunk",
				created: 1,
				model: "test-model",
				choices: [],
				usage,
			})}\n\n` +
			"data: [DONE]\n\n"
		);
	}

	it("includes discarded-attempt raw cost and cache writes in the usage event", async () => {
		const { events } = await run([
			responseWithUsage("", {
				prompt_tokens: 1000,
				completion_tokens: 0,
				total_tokens: 1000,
				prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
				cost: 0.01,
			}),
			responseWithUsage("hello", {
				prompt_tokens: 1000,
				completion_tokens: 10,
				total_tokens: 1010,
				prompt_tokens_details: { cached_tokens: 900, cache_write_tokens: 50 },
				cost: 0.02,
			}),
		]);

		expect(events.filter((event) => event.type === "usage")).toEqual([
			{
				type: "usage",
				requestInputTokens: 1000,
				usage: {
					inputTokens: 2000,
					outputTokens: 10,
					cacheReadTokens: 1700,
					cacheWriteTokens: 150,
					totalCost: 0.03,
				},
			},
		]);
	});

	it.each([
		{ firstCost: 0.01, lastCost: undefined, expectedCost: 0.0121 },
		{ firstCost: undefined, lastCost: 0.02, expectedCost: 0.022 },
		{ firstCost: 0.01, lastCost: 0, expectedCost: 0.01 },
		{ firstCost: 0, lastCost: undefined, expectedCost: 0.0021 },
		{ firstCost: undefined, lastCost: 0, expectedCost: 0.002 },
		{ firstCost: undefined, lastCost: undefined, expectedCost: 0.0041 },
	])("prices each attempt independently for costs $firstCost / $lastCost", async ({
		firstCost,
		lastCost,
		expectedCost,
	}) => {
		const { events } = await run(
			[
				responseWithUsage("", {
					prompt_tokens: 1000,
					completion_tokens: 0,
					total_tokens: 1000,
					...(firstCost !== undefined ? { cost: firstCost } : {}),
				}),
				responseWithUsage("hello", {
					prompt_tokens: 1000,
					completion_tokens: 10,
					total_tokens: 1010,
					...(lastCost !== undefined ? { cost: lastCost } : {}),
				}),
			],
			[],
			{ input: 2, output: 10 },
		);
		const usageEvent = events.find((event) => event.type === "usage");
		expect(usageEvent?.usage).toMatchObject({
			inputTokens: 2000,
			outputTokens: 10,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
		expect(usageEvent?.usage.totalCost).toBeCloseTo(expectedCost, 10);
	});

	it.each([
		[0.01, undefined],
		[undefined, 0.02],
		[undefined, undefined],
	])("keeps total cost unknown without pricing when an attempt cost is missing (%s / %s)", async (firstCost, lastCost) => {
		const { events } = await run([
			responseWithUsage("", {
				prompt_tokens: 1000,
				completion_tokens: 0,
				total_tokens: 1000,
				...(firstCost !== undefined ? { cost: firstCost } : {}),
			}),
			responseWithUsage("hello", {
				prompt_tokens: 1000,
				completion_tokens: 10,
				total_tokens: 1010,
				...(lastCost !== undefined ? { cost: lastCost } : {}),
			}),
		]);
		expect(
			events.find((event) => event.type === "usage")?.usage,
		).not.toHaveProperty("totalCost");
	});

	it("retries an empty turn and streams the successful attempt", async () => {
		const { fetchMock, events } = await run([emptySse, textSse]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(hasTextDelta(events, "hello")).toBe(true);
		const finishes = finishEvents(events);
		expect(finishes).toHaveLength(1);
		expect(finishes[0]).not.toMatchObject({ reason: "error" });
		// The returned HTTP ID, not the SSE generation ID (cmpl-1) or hidden retry's ID.
		expect(finishes[0]).toMatchObject({ requestId: "request-2" });
	});

	it.each([
		"cline",
		"cline-pass",
	])("exposes only returned HTTP IDs for %s", async (providerId) => {
		for (const requestId of ["backend-request", undefined]) {
			const config = {
				providerId,
				apiKey: "test-key",
				baseUrl: "http://fake.local/v1",
				fetch: (async () =>
					new Response(textSse, {
						headers: {
							"content-type": "text/event-stream",
							...(requestId ? { "X-Request-ID": requestId } : {}),
						},
					})) as typeof fetch,
			};
			const provider = await createClineProvider(config);
			const events = await collect(
				await provider.stream(
					{ ...streamRequest(), providerId },
					providerContext(providerId, config),
				),
			);
			expect(hasTextDelta(events, "hello")).toBe(true);
			expect(finishEvents(events)[0]?.requestId).toBe(requestId);
		}
	});

	it("does not retry a non-empty turn", async () => {
		const { fetchMock, events } = await run([textSse]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(hasTextDelta(events, "hello")).toBe(true);
	});

	it("surfaces a filtered empty turn as content-filter without retrying", async () => {
		const filteredSse =
			chunk({ role: "assistant", content: "" }) +
			chunk({}, "content_filter") +
			"data: [DONE]\n\n";
		const { fetchMock, events } = await run([filteredSse]);

		// Retrying a filtered turn just re-bills the same refusal, so the
		// middleware must let it through on the first attempt...
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(events.some((event) => event.type === "text-delta")).toBe(false);
		// ...and the reason must survive as its own finish reason. Collapsed
		// into "stop" (the old behaviour) this became "Model returned empty
		// response", telling the user to retry something that cannot succeed.
		expect(finishEvents(events)).toEqual([
			expect.objectContaining({ reason: "content-filter" }),
		]);
	});

	it("does not retry a tool-call-only turn", async () => {
		const { fetchMock, events } = await run([toolCallSse], [READ_FILES_TOOL]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(events.some((event) => event.type === "tool-call-delta")).toBe(true);
	});

	it("gives up after the default attempts and surfaces the empty turn", async () => {
		const { fetchMock, events } = await run([emptySse]);

		// DEFAULT_EMPTY_RESPONSE_MAX_ATTEMPTS = 3 total attempts, then the
		// empty finish passes through so the agent runtime can fail loudly.
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(events.some((event) => event.type === "text-delta")).toBe(false);
		expect(finishEvents(events)).toHaveLength(1);
	});

	it("retries a pre-content mid-stream network death and recovers without surfacing an error", async () => {
		// The exact failure mode the AI SDK's own retry (request
		// initiation only) never covers: the connection was accepted and
		// the response body then died. Shaped like undici's rejection
		// (`terminated`, cause SocketError/UND_ERR_SOCKET).
		const cause = new Error("other side closed");
		cause.name = "SocketError";
		(cause as Error & { code?: string }).code = "UND_ERR_SOCKET";
		const dyingBody = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(new TypeError("terminated", { cause }));
			},
		});

		let call = 0;
		const fetchMock = vi.fn(async () => {
			call++;
			return call === 1
				? new Response(dyingBody, {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					})
				: new Response(textSse, {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					});
		});
		const config = {
			providerId: "openai-compatible",
			apiKey: "test-key",
			baseUrl: "http://fake.local/v1",
			fetch: fetchMock as unknown as typeof fetch,
		};
		const provider = await createOpenAICompatibleProvider(config);
		const events = await collect(
			await provider.stream(
				streamRequest(),
				providerContext("openai-compatible", config),
			),
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(hasTextDelta(events, "hello")).toBe(true);
		const finishes = finishEvents(events);
		expect(finishes).toHaveLength(1);
		// A successful retry is a non-event: no error-finish surfaces, so
		// no task.provider_api_error is ever reported for it.
		expect(finishes[0]).not.toMatchObject({ reason: "error" });
	}, 15_000); // The retry waits out the real default backoff (2s).

	it("hands a network death after streamed reasoning to the turn-level retry", async () => {
		// Bun's fetch shape for a connection the other side dropped mid-body.
		const socketClosed = new Error(
			"The socket connection was closed unexpectedly.",
		);
		(socketClosed as Error & { code?: string }).code = "ConnectionClosed";
		const encoder = new TextEncoder();
		let sentReasoning = false;
		const fetchMock = vi.fn(
			async () =>
				new Response(
					new ReadableStream<Uint8Array>({
						async pull(controller) {
							if (sentReasoning) {
								// Let the reasoning chunk drain through the SSE
								// pipeline first; an immediate error discards it.
								await new Promise((resolve) => setTimeout(resolve, 50));
								controller.error(socketClosed);
								return;
							}
							sentReasoning = true;
							controller.enqueue(
								encoder.encode(
									chunk({ role: "assistant", reasoning_content: "thinking" }),
								),
							);
						},
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				),
		);
		const config = {
			providerId: "openai-compatible",
			apiKey: "test-key",
			baseUrl: "http://fake.local/v1",
			fetch: fetchMock as unknown as typeof fetch,
		};
		const provider = await createOpenAICompatibleProvider(config);
		const events = await collect(
			await provider.stream(
				streamRequest(),
				providerContext("openai-compatible", config),
			),
		);

		// The middleware does not replay output it already let through...
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(events.some((event) => event.type === "reasoning-delta")).toBe(true);
		// ...so the finish marks it retryable for the agent loop instead.
		expect(finishEvents(events)).toEqual([
			expect.objectContaining({ reason: "error", errorRetryable: true }),
		]);
	});
});

describe("anthropic wire format", () => {
	const sse = (events: Array<Record<string, unknown>>) =>
		events
			.map(
				(event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
			)
			.join("");

	const messageStart = {
		type: "message_start",
		message: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "test-model",
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 0 },
		},
	};
	const messageStop = { type: "message_stop" };
	const messageDelta = (stopReason: string) => ({
		type: "message_delta",
		delta: { stop_reason: stopReason, stop_sequence: null },
		usage: { output_tokens: 1 },
	});

	const emptySse = sse([messageStart, messageDelta("end_turn"), messageStop]);
	const textSse = sse([
		messageStart,
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "hello" },
		},
		{ type: "content_block_stop", index: 0 },
		messageDelta("end_turn"),
		messageStop,
	]);
	const toolUseSse = sse([
		messageStart,
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "tool_use", id: "toolu_1", name: "read_files" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: '{"files":["a.ts"]}' },
		},
		{ type: "content_block_stop", index: 0 },
		messageDelta("tool_use"),
		messageStop,
	]);

	async function run(bodies: string[], tools: AgentToolDefinition[] = []) {
		const fetchMock = queuedFetch(bodies);
		const config = {
			providerId: "anthropic",
			apiKey: "test-key",
			fetch: fetchMock as unknown as typeof fetch,
		};
		const provider = await createAnthropicProvider(config);
		const events = await collect(
			await provider.stream(
				streamRequest(tools),
				providerContext("anthropic", config),
			),
		);
		return { fetchMock, events };
	}

	it("retries an empty turn and streams the successful attempt", async () => {
		const { fetchMock, events } = await run([emptySse, textSse]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(hasTextDelta(events, "hello")).toBe(true);
		expect(finishEvents(events)).toHaveLength(1);
	});

	it("does not retry a tool-call-only turn", async () => {
		const { fetchMock, events } = await run([toolUseSse], [READ_FILES_TOOL]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(events.some((event) => event.type === "tool-call-delta")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Ollama: the vendor-level retry wrap was replaced by the central one; prove
// the provider still retries after the refactor.

const ollamaDoStreamMock = vi.hoisted(() =>
	vi.fn<() => Promise<LanguageModelV4StreamResult>>(),
);

vi.mock("ollama-ai-provider-v2", () => ({
	createOllama: () => ({
		chat: (modelId: string) => ({
			specificationVersion: "v4",
			provider: "ollama",
			modelId,
			supportedUrls: {},
			doGenerate: async () => {
				throw new Error("doGenerate is not used by the streaming path");
			},
			doStream: ollamaDoStreamMock,
		}),
	}),
}));

const v4Usage: LanguageModelV4Usage = {
	inputTokens: {
		total: 1,
		noCache: undefined,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 1, text: undefined, reasoning: undefined },
};

function v4Stream(
	parts: LanguageModelV4StreamPart[],
): LanguageModelV4StreamResult {
	return {
		stream: new ReadableStream<LanguageModelV4StreamPart>({
			start(controller) {
				for (const part of parts) {
					controller.enqueue(part);
				}
				controller.close();
			},
		}),
	};
}

const v4EmptyParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v4Usage,
	},
];
const v4TextParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: "hello" },
	{ type: "text-end", id: "t" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: v4Usage,
	},
];

async function streamThroughOllama(
	parts: LanguageModelV4StreamPart[][],
): Promise<AgentModelEvent[]> {
	ollamaDoStreamMock.mockReset();
	for (const attempt of parts) {
		ollamaDoStreamMock.mockResolvedValueOnce(v4Stream(attempt));
	}
	const config = { providerId: "ollama" };
	const provider = await createOllamaProvider(config);
	return collect(
		await provider.stream(streamRequest(), providerContext("ollama", config)),
	);
}

describe("ollama (central wrap replaces the old vendor-level wrap)", () => {
	it("retries an empty turn and streams the successful attempt", async () => {
		const events = await streamThroughOllama([v4EmptyParts, v4TextParts]);

		expect(ollamaDoStreamMock).toHaveBeenCalledTimes(2);
		expect(hasTextDelta(events, "hello")).toBe(true);
		expect(finishEvents(events)).toHaveLength(1);
	});
});

describe("full path: model output classes through emitAiSdkEvents", () => {
	it.each([
		{
			firstRaw: {},
			firstGateway: { cost: 0.01 },
			lastRaw: {},
			lastGateway: { cost: 0.02 },
			expectedCost: 0.03,
		},
		{
			firstRaw: {},
			firstGateway: { cost: 0.01 },
			lastRaw: {},
			lastGateway: { cost: 0 },
			expectedCost: 0.01,
		},
		{
			firstRaw: {},
			firstGateway: { cost: 0 },
			lastRaw: { cost: 0.02 },
			lastGateway: {},
			expectedCost: 0.02,
		},
		{
			firstRaw: { cost: 0.01 },
			firstGateway: {},
			lastRaw: {},
			lastGateway: { cost: 0.02 },
			expectedCost: 0.03,
		},
		{
			firstRaw: { cost_details: { upstream_inference_cost: 0.02 } },
			firstGateway: { cost: 0.01, isByok: true },
			lastRaw: { cost: 0.04 },
			lastGateway: {},
			expectedCost: 0.07,
		},
	])("keeps each attempt's provider metadata with its usage ($expectedCost)", async ({
		firstRaw,
		firstGateway,
		lastRaw,
		lastGateway,
		expectedCost,
	}) => {
		const events = await streamThroughOllama([
			[
				v4EmptyParts[0],
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: {
						inputTokens: { ...v4Usage.inputTokens, total: 1000 },
						outputTokens: { ...v4Usage.outputTokens, total: 0 },
						raw: firstRaw,
					},
					providerMetadata: {
						gateway: firstGateway,
						vendor: {
							usage: { cache_read_tokens: 20, cache_write_tokens: 50 },
						},
					},
				},
			],
			[
				...v4TextParts.slice(0, -1),
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: {
						inputTokens: {
							total: 1000,
							noCache: undefined,
							cacheRead: 100,
							cacheWrite: 25,
						},
						outputTokens: { ...v4Usage.outputTokens, total: 10 },
						raw: lastRaw,
					},
					providerMetadata: { gateway: lastGateway },
				},
			],
		]);
		const usageEvent = events.find((event) => event.type === "usage");
		expect(usageEvent?.usage).toMatchObject({
			inputTokens: 2000,
			outputTokens: 10,
			cacheReadTokens: 120,
			cacheWriteTokens: 75,
		});
		expect(usageEvent?.usage.totalCost).toBeCloseTo(expectedCost, 10);
	});

	it("normalizes mixed standard and raw cache details before adding attempts", async () => {
		const attemptUsage = (
			cacheWrite: number | undefined,
			raw: LanguageModelV4Usage["raw"],
		): LanguageModelV4Usage => ({
			inputTokens: {
				total: 1000,
				noCache: undefined,
				cacheRead: 100,
				cacheWrite,
			},
			outputTokens: { total: 5, text: 3, reasoning: 2 },
			raw,
		});
		const events = await streamThroughOllama([
			[
				v4EmptyParts[0],
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: attemptUsage(100, {
						cache_write_tokens: 100,
						cost: 0.01,
						is_byok: true,
						cost_details: { upstream_inference_cost: 0.02 },
					}),
				},
			],
			[
				v4EmptyParts[0],
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: attemptUsage(undefined, {
						prompt_tokens_details: { cache_write_tokens: 50 },
						market_cost: 0.04,
					}),
				},
			],
			[
				...v4TextParts.slice(0, -1),
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: attemptUsage(25, { cache_write_tokens: 999, cost: 0 }),
				},
			],
		]);

		expect(events.filter((event) => event.type === "usage")).toEqual([
			{
				type: "usage",
				requestInputTokens: 1000,
				usage: {
					inputTokens: 3000,
					outputTokens: 9,
					cacheReadTokens: 300,
					cacheWriteTokens: 175,
					reasoningTokenCount: 6,
					totalCost: 0.07,
				},
			},
		]);
	});
	it("converts an image-file-only turn into an image event instead of retrying or dropping it", async () => {
		const events = await streamThroughOllama([
			[
				{ type: "stream-start", warnings: [] },
				{
					type: "file",
					mediaType: "image/png",
					data: { type: "data", data: "aGVsbG8=" },
				} as LanguageModelV4StreamPart,
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: v4Usage,
				},
			],
		]);

		// Not retried (a generated file is content)...
		expect(ollamaDoStreamMock).toHaveBeenCalledTimes(1);
		// ...and converted, so the assistant message will not be empty.
		const imageEvent = events.find((event) => event.type === "media");
		expect(imageEvent).toMatchObject({
			type: "media",
			media: {
				id: expect.any(String),
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			},
		});
	});

	it("does not retry a custom-only turn (unsupported output is not empty)", async () => {
		const events = await streamThroughOllama([
			[
				{ type: "stream-start", warnings: [] },
				{
					type: "custom",
					kind: "anthropic.container",
				} as LanguageModelV4StreamPart,
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: v4Usage,
				},
			],
		]);

		// The model responded; retrying would re-bill for the same output.
		// The adapter does not convert custom parts (explicitly unsupported),
		// so no content events are emitted — the downstream empty-message
		// failure, if it happens, is honest rather than masked by retries.
		expect(ollamaDoStreamMock).toHaveBeenCalledTimes(1);
		expect(events.some((event) => event.type === "text-delta")).toBe(false);
		expect(finishEvents(events)).toHaveLength(1);
	});

	it("aggregates discarded-attempt usage into the final usage event", async () => {
		const usageOf = (input: number, output: number) =>
			({
				inputTokens: {
					total: input,
					noCache: undefined,
					cacheRead: undefined,
					cacheWrite: undefined,
				},
				outputTokens: { total: output, text: undefined, reasoning: undefined },
			}) as never;
		const emptyAttempt = (input: number, output: number) => [
			{ type: "stream-start", warnings: [] } as LanguageModelV4StreamPart,
			{
				type: "finish",
				finishReason: { unified: "stop", raw: "stop" },
				usage: usageOf(input, output),
			} as LanguageModelV4StreamPart,
		];
		const events = await streamThroughOllama([
			emptyAttempt(7, 3),
			emptyAttempt(9, 2),
			[
				{ type: "stream-start", warnings: [] },
				{ type: "text-start", id: "t" },
				{ type: "text-delta", id: "t", delta: "hello" },
				{ type: "text-end", id: "t" },
				{
					type: "finish",
					finishReason: { unified: "stop", raw: "stop" },
					usage: usageOf(11, 5),
				},
			],
		]);

		expect(ollamaDoStreamMock).toHaveBeenCalledTimes(3);
		const usageEvent = events.find((event) => event.type === "usage") as
			| { usage: { inputTokens?: number; outputTokens?: number } }
			| undefined;
		expect(usageEvent).toBeDefined();
		// 7 + 9 + 11 input, 3 + 2 + 5 output across all three attempts.
		expect(usageEvent?.usage.inputTokens).toBe(27);
		expect(usageEvent?.usage.outputTokens).toBe(10);
		// Billing totals span all attempts, but compaction needs the final prompt.
		expect(usageEvent).toMatchObject({ requestInputTokens: 11 });
	});

	it("keeps cached tokens in the single request's prompt size", async () => {
		const events = await streamThroughOllama([
			v4TextParts.map((part) =>
				part.type === "finish"
					? {
							...part,
							usage: {
								inputTokens: {
									total: 1000,
									noCache: 50,
									cacheRead: 900,
									cacheWrite: 50,
								},
								outputTokens: { total: 1, text: 1, reasoning: undefined },
							},
						}
					: part,
			),
		]);

		expect(events.find((event) => event.type === "usage")).toMatchObject({
			requestInputTokens: 1000,
			usage: {
				inputTokens: 1000,
				outputTokens: 1,
				cacheReadTokens: 900,
				cacheWriteTokens: 50,
			},
		});
	});
});

describe("withEmptyResponseRetry", () => {
	function fakeModel(results: LanguageModelV4StreamResult[]): LanguageModelV4 {
		const doStream = vi.fn();
		for (const result of results) {
			doStream.mockResolvedValueOnce(result);
		}
		return {
			specificationVersion: "v4",
			provider: "fake",
			modelId: "fake-model",
			supportedUrls: {},
			doGenerate: vi.fn(),
			doStream,
		} as unknown as LanguageModelV4;
	}

	it("returns the model unchanged when a vendor opts out", () => {
		const model = fakeModel([]);
		expect(withEmptyResponseRetry(model, false, undefined)).toBe(model);
	});

	it("wraps by default, preserving the model identity fields", () => {
		const model = fakeModel([]);
		const wrapped = withEmptyResponseRetry(
			model,
			undefined,
			undefined,
		) as LanguageModelV4;
		expect(wrapped).not.toBe(model);
		expect(wrapped.specificationVersion).toBe("v4");
		expect(wrapped.provider).toBe("fake");
		expect(wrapped.modelId).toBe("fake-model");
	});

	it("leaves single-call generate usage and provider raw data unchanged", async () => {
		const raw = Object.freeze({ cost: 0, cache_write_tokens: 7, requests: 1 });
		const generateUsage = { ...v4Usage, raw };
		const model = {
			...fakeModel([]),
			doGenerate: async () => ({
				content: [{ type: "text", text: "hello" }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: generateUsage,
				warnings: [],
			}),
		} as LanguageModelV4;
		const wrapped = withEmptyResponseRetry(
			model,
			undefined,
			undefined,
		) as LanguageModelV4;
		const result = await wrapped.doGenerate({} as never);
		expect(normalizeUsage(result.usage)).toEqual({
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 7,
			totalCost: 0,
		});
		expect(result.usage.raw).toBe(raw);
	});

	it("threads vendor-provided retry options to the middleware", async () => {
		const model = fakeModel([
			v4Stream(v4EmptyParts),
			v4Stream(v4EmptyParts),
			v4Stream(v4EmptyParts),
		]);
		const wrapped = withEmptyResponseRetry(
			model,
			{ maxAttempts: 2, retryDelayMs: 0 },
			undefined,
		) as LanguageModelV4;

		const result = await wrapped.doStream({} as never);
		const reader = result.stream.getReader();
		while (!(await reader.read()).done) {
			// drain
		}

		expect(model.doStream).toHaveBeenCalledTimes(2);
	});
});
