import type {
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
	LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import {
	addUsage,
	createRetryEmptyResponseMiddleware,
	isTransientNetworkError,
} from "./retry-empty-response";
import { classifyModelStreamPart } from "./stream-part-classification";

function streamOf(
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
	} as LanguageModelV4StreamResult;
}

function v4Usage(input: {
	in?: number;
	out?: number;
	cacheRead?: number;
	reasoning?: number;
}): LanguageModelV4Usage {
	return {
		inputTokens: {
			total: input.in,
			noCache: undefined,
			cacheRead: input.cacheRead,
			cacheWrite: undefined,
		},
		outputTokens: {
			total: input.out,
			text: undefined,
			reasoning: input.reasoning,
		},
	};
}

const usage = v4Usage({ in: 1, out: 1 });

const streamStart: LanguageModelV4StreamPart = {
	type: "stream-start",
	warnings: [],
};
function finish(
	finishReason: Extract<
		LanguageModelV4StreamPart,
		{ type: "finish" }
	>["finishReason"]["unified"] = "stop",
	finishUsage: LanguageModelV4Usage = usage,
): Extract<LanguageModelV4StreamPart, { type: "finish" }> {
	return {
		type: "finish",
		finishReason: { unified: finishReason, raw: finishReason },
		usage: finishUsage,
	};
}
const textParts: LanguageModelV4StreamPart[] = [
	streamStart,
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: "hello" },
	{ type: "text-end", id: "t" },
	finish(),
];
const emptyParts: LanguageModelV4StreamPart[] = [streamStart, finish()];
const toolCallParts: LanguageModelV4StreamPart[] = [
	streamStart,
	{
		type: "tool-call",
		toolCallId: "c1",
		toolName: "read_file",
		input: '{"path":"a.ts"}',
	} as LanguageModelV4StreamPart,
	finish("tool-calls"),
];

async function collect(
	result: LanguageModelV4StreamResult,
): Promise<LanguageModelV4StreamPart[]> {
	const out: LanguageModelV4StreamPart[] = [];
	const reader = result.stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		out.push(value);
	}
	return out;
}

function run(
	doStream: () => Promise<LanguageModelV4StreamResult>,
	options: Parameters<typeof createRetryEmptyResponseMiddleware>[0] = {},
	abortSignal?: AbortSignal,
) {
	const middleware = createRetryEmptyResponseMiddleware({
		retryDelayMs: 0,
		networkRetryDelayMs: 0,
		...options,
	});
	// biome-ignore lint/style/noNonNullAssertion: wrapStream is always defined here
	return middleware.wrapStream!({
		doStream,
		doGenerate: vi.fn() as never,
		params: { abortSignal } as never,
		model: { modelId: "llama3.2" } as never,
	});
}

describe("createRetryEmptyResponseMiddleware", () => {
	it("streams a non-empty response through without retrying", async () => {
		const doStream = vi.fn(async () => streamOf(textParts));
		const parts = await collect(await run(doStream));
		expect(doStream).toHaveBeenCalledTimes(1);
		expect(
			parts.some((p) => p.type === "text-delta" && p.delta === "hello"),
		).toBe(true);
		expect(parts.filter((p) => p.type === "finish")).toHaveLength(1);
	});

	it("retries an empty response and forwards the successful attempt", async () => {
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(streamOf(emptyParts))
			.mockResolvedValueOnce(streamOf(textParts));
		const parts = await collect(await run(doStream));
		expect(doStream).toHaveBeenCalledTimes(2);
		// Exactly one stream-start survives across attempts.
		expect(parts.filter((p) => p.type === "stream-start")).toHaveLength(1);
		expect(
			parts.some((p) => p.type === "text-delta" && p.delta === "hello"),
		).toBe(true);
		expect(parts.filter((p) => p.type === "finish")).toHaveLength(1);
	});

	it("does not retry a tool-call-only turn (it is not empty)", async () => {
		const doStream = vi.fn(async () => streamOf(toolCallParts));
		const parts = await collect(await run(doStream));
		expect(doStream).toHaveBeenCalledTimes(1);
		expect(parts.some((p) => p.type === "tool-call")).toBe(true);
	});

	it("gives up after maxAttempts and forwards the final empty finish", async () => {
		const doStream = vi.fn(async () => streamOf(emptyParts));
		const parts = await collect(await run(doStream, { maxAttempts: 3 }));
		expect(doStream).toHaveBeenCalledTimes(3);
		expect(parts.filter((p) => p.type === "finish")).toHaveLength(1);
		expect(parts.some((p) => p.type === "text-delta")).toBe(false);
	});

	it("does not retry when the empty turn hit the token limit", async () => {
		const doStream = vi.fn(async () =>
			streamOf([streamStart, finish("length")]),
		);
		const parts = await collect(await run(doStream));
		expect(doStream).toHaveBeenCalledTimes(1);
		expect(parts.filter((p) => p.type === "finish")).toHaveLength(1);
	});

	it("does not retry when the turn surfaced an error", async () => {
		const doStream = vi.fn(async () =>
			streamOf([streamStart, { type: "error", error: "boom" }, finish()]),
		);
		const parts = await collect(await run(doStream));
		expect(doStream).toHaveBeenCalledTimes(1);
		expect(parts.some((p) => p.type === "error")).toBe(true);
	});

	it("logs a warning on each retry", async () => {
		const log = vi.fn();
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(streamOf(emptyParts))
			.mockResolvedValueOnce(streamOf(textParts));
		await collect(await run(doStream, { logger: { log } }));
		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("empty response"),
			expect.objectContaining({ severity: "warn", attempt: 1 }),
		);
	});

	it("discards a rejected attempt wholesale — no structural parts leak", async () => {
		// The discarded attempt carries structural debris (response metadata,
		// empty text block markers, raw parts) that must never reach the
		// consumer: one retried request produces one clean logical stream.
		const noisyEmptyParts: LanguageModelV4StreamPart[] = [
			streamStart,
			{ type: "response-metadata", id: "resp-discarded" },
			{ type: "text-start", id: "discarded" },
			{ type: "text-end", id: "discarded" },
			{ type: "raw", rawValue: { discarded: true } },
			finish(),
		];
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(streamOf(noisyEmptyParts))
			.mockResolvedValueOnce(streamOf(textParts));
		const parts = await collect(await run(doStream));

		expect(doStream).toHaveBeenCalledTimes(2);
		expect(parts.filter((p) => p.type === "stream-start")).toHaveLength(1);
		expect(parts.some((p) => p.type === "response-metadata")).toBe(false);
		expect(parts.some((p) => p.type === "raw")).toBe(false);
		expect(
			parts.some((p) => p.type === "text-start" && p.id === "discarded"),
		).toBe(false);
		// The accepted attempt's parts arrive complete and in order.
		expect(parts.map((p) => p.type)).toEqual([
			"stream-start",
			"text-start",
			"text-delta",
			"text-end",
			"finish",
		]);
	});

	it("aggregates usage from discarded attempts into the accepted finish", async () => {
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(
				streamOf([
					streamStart,
					finish("stop", v4Usage({ in: 7, out: 3, cacheRead: 5 })),
				]),
			)
			.mockResolvedValueOnce(
				streamOf([
					streamStart,
					finish("stop", v4Usage({ in: 9, out: 2, cacheRead: 4 })),
				]),
			)
			.mockResolvedValueOnce(
				streamOf([
					streamStart,
					{ type: "text-start", id: "t" },
					{ type: "text-delta", id: "t", delta: "hello" },
					{ type: "text-end", id: "t" },
					finish("stop", v4Usage({ in: 11, out: 5, reasoning: 2 })),
				]),
			);
		const parts = await collect(await run(doStream));

		expect(doStream).toHaveBeenCalledTimes(3);
		const finishPart = parts.find((p) => p.type === "finish") as Extract<
			LanguageModelV4StreamPart,
			{ type: "finish" }
		>;
		expect(finishPart.usage.inputTokens.total).toBe(27);
		expect(finishPart.usage.outputTokens.total).toBe(10);
		expect(finishPart.usage.inputTokens.cacheRead).toBe(9);
		expect(finishPart.usage.outputTokens.reasoning).toBe(2);
		// Fields undefined on every attempt stay undefined instead of
		// becoming a fabricated zero.
		expect(finishPart.usage.inputTokens.noCache).toBeUndefined();
	});

	it("aggregates usage across all attempts when retries are exhausted", async () => {
		const doStream = vi.fn(async () =>
			streamOf([streamStart, finish("stop", v4Usage({ in: 7, out: 3 }))]),
		);
		const parts = await collect(await run(doStream, { maxAttempts: 3 }));

		expect(doStream).toHaveBeenCalledTimes(3);
		const finishPart = parts.find((p) => p.type === "finish") as Extract<
			LanguageModelV4StreamPart,
			{ type: "finish" }
		>;
		expect(finishPart.usage.inputTokens.total).toBe(21);
		expect(finishPart.usage.outputTokens.total).toBe(9);
	});

	it("does not retry unsupported-but-real output (custom, reasoning-file, source, tool-result)", async () => {
		const unsupportedParts: LanguageModelV4StreamPart[][] = [
			[streamStart, { type: "custom", kind: "anthropic.container" }, finish()],
			[
				streamStart,
				{
					type: "reasoning-file",
					mediaType: "application/octet-stream",
					data: { type: "data", data: "b64" },
				} as LanguageModelV4StreamPart,
				finish(),
			],
			[
				streamStart,
				{
					type: "source",
					sourceType: "url",
					id: "s1",
					url: "https://example.com",
				} as LanguageModelV4StreamPart,
				finish(),
			],
			[
				streamStart,
				{
					type: "tool-result",
					toolCallId: "c1",
					toolName: "web_search",
					result: { hits: [] },
				} as unknown as LanguageModelV4StreamPart,
				finish(),
			],
		];
		for (const parts of unsupportedParts) {
			const doStream = vi.fn(async () => streamOf(parts));
			const out = await collect(await run(doStream));
			expect(doStream).toHaveBeenCalledTimes(1);
			// The output passes through unchanged rather than being retried.
			expect(out.map((p) => p.type)).toEqual(parts.map((p) => p.type));
		}
	});

	it("does not retry a file-only turn (generated files are content)", async () => {
		const fileParts: LanguageModelV4StreamPart[] = [
			streamStart,
			{
				type: "file",
				mediaType: "image/png",
				data: { type: "data", data: "aGVsbG8=" },
			} as LanguageModelV4StreamPart,
			finish(),
		];
		const doStream = vi.fn(async () => streamOf(fileParts));
		const parts = await collect(await run(doStream));
		expect(doStream).toHaveBeenCalledTimes(1);
		expect(parts.some((p) => p.type === "file")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Mid-stream network interruptions. The error shapes mirror what Node's
// fetch (undici) actually rejects with when a live response body dies — the
// exact signatures surfaced by task.provider_api_error telemetry on the SDK
// arch: `terminated: SocketError: other side closed (UND_ERR_SOCKET)`,
// `terminated: BodyTimeoutError`, `terminated: read ECONNRESET`,
// `fetch failed: HeadersTimeoutError`.

function networkError(
	message: string,
	cause?: { name?: string; code?: string; message?: string },
): TypeError {
	let causeError: Error | undefined;
	if (cause) {
		causeError = new Error(cause.message ?? "network failure");
		if (cause.name) {
			causeError.name = cause.name;
		}
		if (cause.code) {
			(causeError as Error & { code?: string }).code = cause.code;
		}
	}
	return new TypeError(message, causeError ? { cause: causeError } : {});
}

const undiciSocketClosed = () =>
	networkError("terminated", {
		name: "SocketError",
		code: "UND_ERR_SOCKET",
		message: "other side closed",
	});

/**
 * Delivers `parts`, then rejects with `error`. Pull-based, and the failure
 * lands on a later macrotask: with a live connection, delivered parts reach
 * the consumer measurably before the socket dies. Erroring synchronously
 * would instead discard chunks still queued in the stream pipeline, which
 * is not how a real connection fails.
 */
function streamThatDies(
	parts: LanguageModelV4StreamPart[],
	error: unknown,
): LanguageModelV4StreamResult {
	let index = 0;
	return {
		stream: new ReadableStream<LanguageModelV4StreamPart>({
			async pull(controller) {
				if (index < parts.length) {
					controller.enqueue(parts[index++]);
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 0));
				controller.error(error);
			},
		}),
	} as LanguageModelV4StreamResult;
}

async function collectWithError(result: LanguageModelV4StreamResult): Promise<{
	parts: LanguageModelV4StreamPart[];
	error: unknown;
}> {
	const parts: LanguageModelV4StreamPart[] = [];
	const reader = result.stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			parts.push(value);
		}
	} catch (error) {
		return { parts, error };
	}
	return { parts, error: undefined };
}

describe("network interruption retry", () => {
	it.each([
		["UND_ERR_SOCKET (other side closed)", undiciSocketClosed()],
		[
			"UND_ERR_BODY_TIMEOUT",
			networkError("terminated", {
				name: "BodyTimeoutError",
				code: "UND_ERR_BODY_TIMEOUT",
			}),
		],
		["read ECONNRESET", networkError("terminated", { code: "ECONNRESET" })],
		[
			"fetch failed: HeadersTimeoutError",
			networkError("fetch failed", {
				name: "HeadersTimeoutError",
				code: "UND_ERR_HEADERS_TIMEOUT",
			}),
		],
	])("retries a pre-content %s death and recovers", async (_label, failure) => {
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(streamThatDies([streamStart], failure))
			.mockResolvedValueOnce(streamOf(textParts));
		const { parts, error } = await collectWithError(await run(doStream));

		expect(doStream).toHaveBeenCalledTimes(2);
		expect(error).toBeUndefined();
		// The dead attempt is discarded wholesale — one clean logical stream.
		expect(parts.filter((p) => p.type === "stream-start")).toHaveLength(1);
		expect(
			parts.some((p) => p.type === "text-delta" && p.delta === "hello"),
		).toBe(true);
		expect(parts.filter((p) => p.type === "finish")).toHaveLength(1);
	});

	it("does not retry once content has flowed (would replay shown text)", async () => {
		const failure = undiciSocketClosed();
		const doStream = vi.fn(async () =>
			streamThatDies(
				[
					streamStart,
					{ type: "text-start", id: "t" },
					{ type: "text-delta", id: "t", delta: "partial" },
				],
				failure,
			),
		);
		const { parts, error } = await collectWithError(await run(doStream));

		expect(doStream).toHaveBeenCalledTimes(1);
		expect(
			parts.some((p) => p.type === "text-delta" && p.delta === "partial"),
		).toBe(true);
		expect(error).toBe(failure);
	});

	it("does not retry non-network stream failures", async () => {
		const failure = new Error("401 Unauthorized: invalid API key");
		const doStream = vi.fn(async () => streamThatDies([streamStart], failure));
		const { error } = await collectWithError(await run(doStream));

		expect(doStream).toHaveBeenCalledTimes(1);
		expect(error).toBe(failure);
	});

	it("does not retry when the request was aborted", async () => {
		const abort = new AbortController();
		abort.abort();
		const failure = undiciSocketClosed();
		const doStream = vi.fn(async () => streamThatDies([streamStart], failure));
		const { error } = await collectWithError(
			await run(doStream, {}, abort.signal),
		);

		expect(doStream).toHaveBeenCalledTimes(1);
		expect(error).toBe(failure);
	});

	it("stops retrying when the user aborts during the backoff sleep", async () => {
		const abort = new AbortController();
		const doStream = vi.fn(async () =>
			streamThatDies([streamStart], undiciSocketClosed()),
		);
		setTimeout(() => abort.abort(), 20);

		const startedAt = Date.now();
		const { error } = await collectWithError(
			await run(doStream, { networkRetryDelayMs: 30_000 }, abort.signal),
		);

		expect(doStream).toHaveBeenCalledTimes(1);
		expect(error).toBeDefined();
		// Resolved by the abort, not by waiting out the 30s backoff.
		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});

	it("propagates the final failure after the attempt budget is exhausted", async () => {
		const failures = [
			undiciSocketClosed(),
			networkError("terminated", { code: "ECONNRESET" }),
			networkError("terminated", { code: "UND_ERR_BODY_TIMEOUT" }),
		];
		let call = 0;
		const doStream = vi.fn(async () =>
			streamThatDies([streamStart], failures[call++]),
		);
		const { error } = await collectWithError(
			await run(doStream, { maxAttempts: 3 }),
		);

		expect(doStream).toHaveBeenCalledTimes(3);
		expect(error).toBe(failures[2]);
	});

	it("shares the attempt budget with empty-response retries", async () => {
		// Attempt 1: empty turn. Attempt 2: network death. Attempt 3 would
		// exceed maxAttempts=2, so the failure surfaces.
		const failure = undiciSocketClosed();
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(streamOf(emptyParts))
			.mockResolvedValueOnce(streamThatDies([streamStart], failure));
		const { error } = await collectWithError(
			await run(doStream, { maxAttempts: 2 }),
		);

		expect(doStream).toHaveBeenCalledTimes(2);
		expect(error).toBe(failure);
	});

	it("aggregates usage from an attempt that delivered its finish before dying", async () => {
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(
				streamThatDies(
					[streamStart, finish("stop", v4Usage({ in: 7, out: 3 }))],
					undiciSocketClosed(),
				),
			)
			.mockResolvedValueOnce(
				streamOf([
					streamStart,
					{ type: "text-start", id: "t" },
					{ type: "text-delta", id: "t", delta: "hello" },
					{ type: "text-end", id: "t" },
					finish("stop", v4Usage({ in: 11, out: 5 })),
				]),
			);
		const { parts, error } = await collectWithError(await run(doStream));

		expect(error).toBeUndefined();
		const finishPart = parts.find((p) => p.type === "finish") as Extract<
			LanguageModelV4StreamPart,
			{ type: "finish" }
		>;
		expect(finishPart.usage.inputTokens.total).toBe(18);
		expect(finishPart.usage.outputTokens.total).toBe(8);
	});

	it("scales network backoff by the network retry count, not the shared attempt number", async () => {
		// Attempt 1: empty response (its own 250ms-class delay). Attempt 2:
		// FIRST network interruption — its backoff must be the configured
		// base delay, not doubled just because an empty retry came first.
		const log = vi.fn();
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(streamOf(emptyParts))
			.mockResolvedValueOnce(
				streamThatDies([streamStart], undiciSocketClosed()),
			)
			.mockResolvedValueOnce(
				streamThatDies([streamStart], undiciSocketClosed()),
			)
			.mockResolvedValueOnce(streamOf(textParts));
		const { error } = await collectWithError(
			await run(doStream, {
				maxAttempts: 4,
				networkRetryDelayMs: 8,
				logger: { log },
			}),
		);

		expect(error).toBeUndefined();
		expect(doStream).toHaveBeenCalledTimes(4);
		const networkDelays = log.mock.calls
			.filter(([message]) => String(message).includes("network interruption"))
			.map(([, meta]) => (meta as { retryDelayMs?: number }).retryDelayMs);
		// First network retry waits the base delay; the second doubles it.
		expect(networkDelays).toEqual([8, 16]);
	});

	it("logs a warning on each network retry", async () => {
		const log = vi.fn();
		const doStream = vi
			.fn()
			.mockResolvedValueOnce(
				streamThatDies([streamStart], undiciSocketClosed()),
			)
			.mockResolvedValueOnce(streamOf(textParts));
		await collectWithError(await run(doStream, { logger: { log } }));

		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("network interruption"),
			expect.objectContaining({ severity: "warn", attempt: 1 }),
		);
	});
});

describe("isTransientNetworkError", () => {
	it("matches the surfaced undici/socket failure shapes", () => {
		expect(isTransientNetworkError(undiciSocketClosed())).toBe(true);
		expect(
			isTransientNetworkError(
				networkError("terminated", { code: "UND_ERR_BODY_TIMEOUT" }),
			),
		).toBe(true);
		expect(
			isTransientNetworkError(
				networkError("terminated", { code: "ECONNRESET" }),
			),
		).toBe(true);
		expect(
			isTransientNetworkError(
				networkError("fetch failed", { code: "UND_ERR_HEADERS_TIMEOUT" }),
			),
		).toBe(true);
		// A bare "terminated" without a cause is still a transport death.
		expect(isTransientNetworkError(new TypeError("terminated"))).toBe(true);
		// Bun's fetch surfaces socket deaths with its own codes.
		const bunClosed = new Error("The socket connection was closed");
		(bunClosed as Error & { code?: string }).code = "ConnectionClosed";
		expect(isTransientNetworkError(bunClosed)).toBe(true);
	});

	it("vetoes aborts, even wrapped in network vocabulary", () => {
		const abort = new Error("This operation was aborted");
		abort.name = "AbortError";
		expect(isTransientNetworkError(abort)).toBe(false);
		expect(
			isTransientNetworkError(new TypeError("terminated", { cause: abort })),
		).toBe(false);
	});

	it("does not match business or context-window errors", () => {
		expect(isTransientNetworkError(new Error("401 Unauthorized"))).toBe(false);
		expect(isTransientNetworkError(new Error("Insufficient balance"))).toBe(
			false,
		);
		expect(
			isTransientNetworkError(
				new Error("prompt is too long: 210000 tokens > 200000 maximum"),
			),
		).toBe(false);
		expect(isTransientNetworkError("terminated")).toBe(false);
		expect(isTransientNetworkError(undefined)).toBe(false);
	});
});

describe("classifyModelStreamPart", () => {
	it("treats empty deltas as structural, not content", () => {
		expect(
			classifyModelStreamPart({ type: "text-delta", id: "t", delta: "" }),
		).toBe("structural");
		expect(
			classifyModelStreamPart({ type: "text-delta", id: "t", delta: "x" }),
		).toBe("converted-content");
	});

	it("classifies output the adapter cannot convert as unsupported, not empty", () => {
		expect(
			classifyModelStreamPart({
				type: "custom",
				kind: "anthropic.container",
			}),
		).toBe("unsupported-output");
	});
});

describe("addUsage", () => {
	it("sums defined fields and preserves undefined for absent ones", () => {
		const sum = addUsage(
			v4Usage({ in: 7, out: 3, cacheRead: 5 }),
			v4Usage({ in: 11, out: 5, reasoning: 2 }),
		);
		expect(sum.inputTokens.total).toBe(18);
		expect(sum.outputTokens.total).toBe(8);
		expect(sum.inputTokens.cacheRead).toBe(5);
		expect(sum.outputTokens.reasoning).toBe(2);
		expect(sum.inputTokens.noCache).toBeUndefined();
	});
});
