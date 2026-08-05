import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createOpenAICompatibleProvider,
	DEFAULT_STREAM_CHUNK_TIMEOUT_MS,
	DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
	resolveStreamStallTimeouts,
} from "./ai-sdk";

/**
 * Stream-stall watchdog tests (ENG: CLI hangs on "Thinking..." forever).
 *
 * A provider stream that stops delivering chunks while keeping the
 * connection open (half-open TCP, dead proxy hop — observed with hosted
 * gateway providers on long reasoning turns) used to hang the agent turn
 * forever: no timeout existed anywhere on the streaming path, so the CLI
 * showed a permanent "Thinking..." spinner until the process was killed.
 *
 * These tests drive the real adapter + real `ai` package with a fake wire
 * response that stalls at various points, and prove the watchdog turns the
 * silent hang into a `finish { reason: "error", errorClass:
 * "stream_stalled" }` the agent loop can retry.
 */

const encoder = new TextEncoder();

const chunk = (delta: unknown, finish: string | null = null) =>
	`data: ${JSON.stringify({
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	})}\n\n`;

/**
 * A fetch whose SSE body emits `prefix` and then stalls forever. Mirrors
 * real fetch semantics: when the request's abort signal fires, the pending
 * body read rejects with the signal's reason (the watchdog's TimeoutError).
 */
function stallingFetch(prefix: string[]) {
	return vi.fn(async (_url: unknown, init?: RequestInit) => {
		const signal = init?.signal ?? undefined;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const part of prefix) {
					controller.enqueue(encoder.encode(part));
				}
				signal?.addEventListener(
					"abort",
					() => {
						try {
							controller.error(
								signal.reason ?? new DOMException("aborted", "AbortError"),
							);
						} catch {
							// stream already errored/closed
						}
					},
					{ once: true },
				);
			},
		});
		return new Response(stream, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	});
}

function completingFetch(body: string) {
	return vi.fn(
		async () =>
			new Response(body, {
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
	overrides: Partial<GatewayStreamRequest> = {},
): GatewayStreamRequest {
	return {
		providerId: "cline",
		modelId: "test-model",
		messages: [
			{
				id: "msg_user",
				role: "user",
				content: [{ type: "text", text: "do the thing" }],
				createdAt: new Date(),
			},
		],
		tools: [],
		...overrides,
	} as unknown as GatewayStreamRequest;
}

function providerContext(config: Record<string, unknown>) {
	const model = { id: "test-model", providerId: "cline", name: "test-model" };
	return {
		provider: {
			id: "cline",
			name: "cline",
			defaultModelId: "test-model",
			models: [model],
		},
		model,
		config,
	} as unknown as GatewayProviderContext;
}

async function runStream(input: {
	fetch: ReturnType<typeof vi.fn>;
	timeoutMs?: number;
	request?: GatewayStreamRequest;
}) {
	const config = {
		providerId: "cline",
		apiKey: "test-key",
		baseUrl: "http://fake.local/v1",
		timeoutMs: input.timeoutMs,
		fetch: input.fetch as unknown as typeof fetch,
	};
	const provider = await createOpenAICompatibleProvider(config);
	return collect(
		await provider.stream(
			input.request ?? streamRequest(),
			providerContext(config),
		),
	);
}

function finishEvent(events: AgentModelEvent[]) {
	const finishes = events.filter((event) => event.type === "finish");
	expect(finishes).toHaveLength(1);
	return finishes[0] as Extract<AgentModelEvent, { type: "finish" }>;
}

describe("resolveStreamStallTimeouts", () => {
	it("applies the global defaults when nothing is configured", () => {
		expect(resolveStreamStallTimeouts({}, {})).toEqual({
			firstChunkMs: DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
			chunkMs: DEFAULT_STREAM_CHUNK_TIMEOUT_MS,
		});
	});

	it("prefers the request apiTimeoutMs over everything else", () => {
		expect(
			resolveStreamStallTimeouts(
				{ apiTimeoutMs: 600_000 },
				{ timeoutMs: 30_000 },
				{ firstChunkMs: 1, chunkMs: 1 },
			),
		).toEqual({ firstChunkMs: 600_000, chunkMs: 600_000 });
	});

	it("falls back to the provider config timeoutMs", () => {
		expect(
			resolveStreamStallTimeouts({}, { timeoutMs: 45_000 }),
		).toEqual({ firstChunkMs: 45_000, chunkMs: 45_000 });
	});

	it("uses vendor fallbacks below config overrides", () => {
		expect(
			resolveStreamStallTimeouts(
				{},
				{},
				{ firstChunkMs: 300_000, chunkMs: 300_000 },
			),
		).toEqual({ firstChunkMs: 300_000, chunkMs: 300_000 });
	});

	it("lets a vendor opt out entirely", () => {
		expect(resolveStreamStallTimeouts({}, {}, false)).toBeUndefined();
	});

	it("ignores non-positive and non-finite overrides", () => {
		expect(
			resolveStreamStallTimeouts(
				{ apiTimeoutMs: 0 },
				{ timeoutMs: Number.NaN },
			),
		).toEqual({
			firstChunkMs: DEFAULT_STREAM_FIRST_CHUNK_TIMEOUT_MS,
			chunkMs: DEFAULT_STREAM_CHUNK_TIMEOUT_MS,
		});
	});
});

describe("stream-stall watchdog (openai-compatible wire format)", () => {
	it("fails a turn whose stream stalls mid-reasoning", async () => {
		const events = await runStream({
			fetch: stallingFetch([
				chunk({ role: "assistant" }),
				chunk({ reasoning_content: "The user wants" }),
			]),
			timeoutMs: 150,
		});

		expect(
			events.some(
				(event) =>
					event.type === "reasoning-delta" &&
					event.text.includes("The user wants"),
			),
		).toBe(true);
		const finish = finishEvent(events);
		expect(finish.reason).toBe("error");
		expect(finish.errorClass).toBe("stream_stalled");
		expect(finish.error).toMatch(/stalled/i);
		expect(finish.error).toMatch(/timeout/i);
	});

	it("fails a turn whose stream never produces a first chunk", async () => {
		const events = await runStream({
			fetch: stallingFetch([]),
			timeoutMs: 150,
		});

		const finish = finishEvent(events);
		expect(finish.reason).toBe("error");
		expect(finish.errorClass).toBe("stream_stalled");
		expect(finish.error).toMatch(/first chunk timeout/i);
	});

	it("fails a turn whose stream stalls mid-text", async () => {
		const events = await runStream({
			fetch: stallingFetch([
				chunk({ role: "assistant" }),
				chunk({ content: "Let me start working on th" }),
			]),
			timeoutMs: 150,
		});

		const finish = finishEvent(events);
		expect(finish.reason).toBe("error");
		expect(finish.errorClass).toBe("stream_stalled");
	});

	it("honors the request-level apiTimeoutMs override", async () => {
		const events = await runStream({
			fetch: stallingFetch([chunk({ role: "assistant" })]),
			// Provider config would wait far longer; the request override
			// must win so agent-level apiTimeoutMs works end to end.
			timeoutMs: 60_000,
			request: streamRequest({ apiTimeoutMs: 150 }),
		});

		const finish = finishEvent(events);
		expect(finish.reason).toBe("error");
		expect(finish.errorClass).toBe("stream_stalled");
	});

	it("never classifies a caller abort as stream_stalled", async () => {
		const controller = new AbortController();
		const fetchMock = stallingFetch([
			chunk({ role: "assistant" }),
			chunk({ content: "partial" }),
		]);
		const pending = runStream({
			fetch: fetchMock,
			timeoutMs: 60_000,
			request: streamRequest({ signal: controller.signal }),
		});
		// Let the stream start, then cancel like the user pressing Esc.
		await new Promise((resolve) => setTimeout(resolve, 100));
		controller.abort();
		const events = await pending;

		// A caller abort may still surface as a generic finish error (the
		// usage promise rejects — pre-existing behavior the agent loop
		// ignores because its own signal is aborted), but it must never be
		// classified as a stall, or the runtime would retry a turn the user
		// intentionally cancelled.
		const finish = finishEvent(events);
		expect(finish.errorClass).not.toBe("stream_stalled");
		expect(finish.error ?? "").not.toMatch(/stalled/i);
	});

	it("does not interfere with a healthy turn", async () => {
		const events = await runStream({
			fetch: completingFetch(
				chunk({ role: "assistant" }) +
					chunk({ content: "hello" }) +
					chunk({}, "stop") +
					"data: [DONE]\n\n",
			),
			timeoutMs: 5_000,
		});

		const finish = finishEvent(events);
		expect(finish.reason).toBe("stop");
		expect(
			events.some(
				(event) => event.type === "text-delta" && event.text === "hello",
			),
		).toBe(true);
	});
});
