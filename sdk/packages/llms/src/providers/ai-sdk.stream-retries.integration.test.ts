import { APICallError, type LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { jsonSchema, streamText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClineProvider } from "./ai-sdk";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function start(options: {
	error?: unknown;
	failures?: number;
	parts?: LanguageModelV4StreamPart[];
	requestFailures?: number;
	maxRetries?: number;
	signal?: AbortSignal;
	callbackRetry?: boolean;
	execute?: () => Promise<string>;
}) {
	const times: number[] = [];
	let streamCalls = 0;
	const model = new MockLanguageModelV4({
		doStream: async () => {
			times.push(Date.now());
			if (times.length <= (options.requestFailures ?? 0)) {
				throw new APICallError({
					message: "request unavailable",
					url: "https://example.test",
					requestBodyValues: {},
					statusCode: 503,
					isRetryable: true,
				});
			}
			const fails = streamCalls++ < (options.failures ?? 1);
			return {
				stream: new ReadableStream<LanguageModelV4StreamPart>({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
						for (const part of options.parts ?? []) controller.enqueue(part);
						if (fails)
							controller.enqueue({ type: "error", error: options.error });
						else if (!options.parts?.length) {
							controller.enqueue({ type: "text-start", id: "text" });
							controller.enqueue({
								type: "text-delta",
								id: "text",
								delta: "ok",
							});
							controller.enqueue({ type: "text-end", id: "text" });
						}
						controller.enqueue({
							type: "finish",
							finishReason: { unified: "stop", raw: undefined },
							usage: {
								inputTokens: {
									total: 1,
									noCache: 1,
									cacheRead: 0,
									cacheWrite: 0,
								},
								outputTokens: { total: 1, text: 1, reasoning: 0 },
							},
						});
						controller.close();
					},
				}),
			};
		},
	});
	const result = streamText({
		model,
		prompt: "test",
		maxRetries: options.maxRetries ?? 0,
		streamRetries: 3,
		abortSignal: options.signal,
		onError: () => (options.callbackRetry ? { retry: true } : undefined),
		tools: {
			test: tool({
				inputSchema: jsonSchema<Record<string, never>>({
					type: "object",
					properties: {},
				}),
				...(options.execute ? { execute: options.execute } : {}),
			}),
		},
	});
	for (const promise of [
		result.text,
		result.usage,
		result.totalUsage,
		result.steps,
		result.finishReason,
		result.response,
	])
		promise.catch(() => {});
	const errors: unknown[] = [];
	const completion = (async () => {
		for await (const part of result.fullStream)
			if (part.type === "error") errors.push(part.error);
	})();
	return { times, errors, completion };
}

it.each([
	false,
	undefined,
])("does not automatically retry isRetryable=%s", async (isRetryable) => {
	const run = start({
		error: {
			message: "failure",
			isRetryable,
			...(isRetryable === false ? { statusCode: 503 } : {}),
		},
	});
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times).toHaveLength(1);
	expect(run.errors).toHaveLength(1);
});
it("backs off for 2s, 4s, and 8s and stops after three stream retries", async () => {
	const run = start({
		error: { message: "unavailable", isRetryable: true },
		failures: 4,
	});
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times.map((time) => time - run.times[0])).toEqual([
		0, 2000, 6000, 14000,
	]);
	expect(run.errors).toHaveLength(1);
});
it("recovers from retryable stream errors", async () => {
	const run = start({
		error: { message: "unavailable", isRetryable: true },
		failures: 2,
	});
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times).toHaveLength(3);
	expect(run.errors).toEqual([]);
});
it("keeps maxRetries separate from streamRetries", async () => {
	const run = start({
		error: { message: "unavailable", isRetryable: true },
		requestFailures: 1,
		maxRetries: 1,
	});
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times.map((time) => time - run.times[0])).toEqual([0, 2000, 4000]);
	expect(run.errors).toEqual([]);
});
it("does not spend streamRetries on a request-start failure", async () => {
	const run = start({ requestFailures: 1, maxRetries: 0 });
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times).toHaveLength(1);
	expect(run.errors).toHaveLength(1);
});
it.each([
	"tool-input-start",
	"tool-call",
	"tool-result",
] as const)("does not replay after provider-owned %s, even if onError requests retry", async (type) => {
	const part: LanguageModelV4StreamPart =
		type === "tool-input-start"
			? { type, id: "call", toolName: "test", providerExecuted: true }
			: type === "tool-call"
				? {
						type,
						toolCallId: "call",
						toolName: "test",
						input: "{}",
						providerExecuted: true,
					}
				: { type, toolCallId: "call", toolName: "test", result: "done" };
	const run = start({
		error: { message: "unavailable", isRetryable: true },
		parts: [part],
		callbackRetry: true,
	});
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times).toHaveLength(1);
});
it("does not let onError override explicit non-retryability", async () => {
	const run = start({
		error: { message: "invalid request", isRetryable: false },
		callbackRetry: true,
	});
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times).toHaveLength(1);
});
it("buffers local tools until a successful attempt, then executes once", async () => {
	const execute = vi.fn(async () => "done");
	const run = start({
		error: { message: "unavailable", isRetryable: true },
		parts: [
			{ type: "tool-call", toolCallId: "call", toolName: "test", input: "{}" },
		],
		execute,
	});
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times).toHaveLength(2);
	expect(execute).toHaveBeenCalledTimes(1);
});
it("aborts backoff without sending another request", async () => {
	const abort = new AbortController();
	const run = start({
		error: { message: "unavailable", isRetryable: true },
		signal: abort.signal,
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(run.times).toHaveLength(1);
	expect(vi.getTimerCount()).toBeGreaterThan(0);
	abort.abort();
	await vi.runAllTimersAsync();
	await run.completion;
	expect(run.times).toHaveLength(1);
});

it.each([
	false,
	true,
])("honors normalized wire retryability=%s through the real Cline adapter", async (isRetryable) => {
	const fetchMock = vi.fn(async () => {
		const body =
			fetchMock.mock.calls.length === 1
				? `data: ${JSON.stringify({ error: { message: "unavailable", type: "server_error", code: isRetryable ? 503 : 400 } })}\n\ndata: [DONE]\n\n`
				: `data: ${JSON.stringify({ id: "cmpl-1", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "recovered" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
		return new Response(body, {
			headers: { "content-type": "text/event-stream" },
		});
	});
	const config = {
		providerId: "cline",
		apiKey: "test",
		baseUrl: "https://example.test/v1",
		fetch: fetchMock as unknown as typeof fetch,
	};
	const model = { id: "test-model", providerId: "cline", name: "test-model" };
	const events: AgentModelEvent[] = [];
	const completion = (async () => {
		const provider = await createClineProvider(config);
		const stream = await provider.stream(
			{
				providerId: "cline",
				modelId: model.id,
				messages: [
					{
						id: "user",
						role: "user",
						content: [{ type: "text", text: "test" }],
						createdAt: new Date(),
					},
				],
			} as GatewayStreamRequest,
			{
				provider: {
					id: "cline",
					name: "cline",
					defaultModelId: model.id,
					models: [model],
				},
				model,
				config,
			} as unknown as GatewayProviderContext,
		);
		for await (const event of stream) events.push(event);
	})();
	await vi.runAllTimersAsync();
	await completion;
	expect(fetchMock).toHaveBeenCalledTimes(isRetryable ? 2 : 1);
	expect(events.filter((event) => event.type === "finish")).toHaveLength(1);
	expect(events.find((event) => event.type === "finish")).toMatchObject(
		isRetryable ? { reason: "stop" } : { reason: "error" },
	);
});
