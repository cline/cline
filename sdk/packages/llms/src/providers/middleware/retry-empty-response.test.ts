import type {
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
	LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import {
	addUsage,
	createRetryEmptyResponseMiddleware,
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
) {
	const middleware = createRetryEmptyResponseMiddleware({
		retryDelayMs: 0,
		...options,
	});
	// biome-ignore lint/style/noNonNullAssertion: wrapStream is always defined here
	return middleware.wrapStream!({
		doStream,
		doGenerate: vi.fn() as never,
		params: {} as never,
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
