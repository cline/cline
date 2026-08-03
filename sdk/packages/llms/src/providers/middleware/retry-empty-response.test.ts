import type {
	LanguageModelV3StreamPart,
	LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { createRetryEmptyResponseMiddleware } from "./retry-empty-response";

function streamOf(
	parts: LanguageModelV3StreamPart[],
): LanguageModelV3StreamResult {
	return {
		stream: new ReadableStream<LanguageModelV3StreamPart>({
			start(controller) {
				for (const part of parts) {
					controller.enqueue(part);
				}
				controller.close();
			},
		}),
	} as LanguageModelV3StreamResult;
}

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 } as never;

const streamStart: LanguageModelV3StreamPart = {
	type: "stream-start",
	warnings: [],
};
function finish(finishReason = "stop"): LanguageModelV3StreamPart {
	return { type: "finish", finishReason, usage } as LanguageModelV3StreamPart;
}
const textParts: LanguageModelV3StreamPart[] = [
	streamStart,
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: "hello" },
	{ type: "text-end", id: "t" },
	finish(),
];
const emptyParts: LanguageModelV3StreamPart[] = [streamStart, finish()];
const toolCallParts: LanguageModelV3StreamPart[] = [
	streamStart,
	{
		type: "tool-call",
		toolCallId: "c1",
		toolName: "read_file",
		input: '{"path":"a.ts"}',
	} as LanguageModelV3StreamPart,
	finish("tool-calls"),
];

async function collect(
	result: LanguageModelV3StreamResult,
): Promise<LanguageModelV3StreamPart[]> {
	const out: LanguageModelV3StreamPart[] = [];
	const reader = result.stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		out.push(value);
	}
	return out;
}

function run(
	doStream: () => Promise<LanguageModelV3StreamResult>,
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
});
