import type {
	LanguageModelV4,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
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
	createOllamaProvider,
	createOpenAICompatibleProvider,
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
				headers: { "content-type": "text/event-stream" },
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
): GatewayProviderContext {
	const model = { id: "test-model", providerId, name: "test-model" };
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

	async function run(bodies: string[], tools: AgentToolDefinition[] = []) {
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
				providerContext("openai-compatible", config),
			),
		);
		return { fetchMock, events };
	}

	it("retries an empty turn and streams the successful attempt", async () => {
		const { fetchMock, events } = await run([emptySse, textSse]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(hasTextDelta(events, "hello")).toBe(true);
		const finishes = finishEvents(events);
		expect(finishes).toHaveLength(1);
		expect(finishes[0]).not.toMatchObject({ reason: "error" });
	});

	it("does not retry a non-empty turn", async () => {
		const { fetchMock, events } = await run([textSse]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(hasTextDelta(events, "hello")).toBe(true);
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

const v4Usage = {
	inputTokens: {
		total: 1,
		noCache: undefined,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 1, text: undefined, reasoning: undefined },
} as never;

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
