import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
	ITelemetryService,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createOpenAICompatibleProvider } from "./ai-sdk";

/**
 * Drives the real adapter and the real `ai` package with an OpenAI-compatible
 * SSE body whose first frame is a provider error, the shape capacity failures
 * arrive in. The AI SDK's stream retry re-dials; the adapter's `onError` must
 * hold that re-dial for the backoff and report the wait to the caller.
 */

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

const overloadedSse = sse({
	error: {
		message: "Our servers are currently overloaded. Please try again later.",
		type: "service_unavailable_error",
		code: "server_is_overloaded",
		param: null,
	},
});

const chunk = (delta: unknown, finish: string | null = null) =>
	sse({
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	});

const textSse =
	chunk({ role: "assistant", content: "hello" }) +
	chunk({}, "stop") +
	"data: [DONE]\n\n";

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

async function run(input: {
	bodies: string[];
	signal?: AbortSignal;
	emitStatusNotice: ReturnType<typeof vi.fn>;
}) {
	const fetchMock = queuedFetch(input.bodies);
	const config = {
		providerId: "openai-compatible",
		apiKey: "test-key",
		baseUrl: "http://fake.local/v1",
		fetch: fetchMock as unknown as typeof fetch,
	};
	const provider = await createOpenAICompatibleProvider(config);
	const request = {
		providerId: "openai-compatible",
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
		signal: input.signal,
		emitStatusNotice: input.emitStatusNotice,
	} as unknown as GatewayStreamRequest;
	const model = {
		id: "test-model",
		providerId: "openai-compatible",
		name: "test-model",
	};
	const capture = vi.fn();
	const context = {
		provider: {
			id: "openai-compatible",
			name: "openai-compatible",
			defaultModelId: "test-model",
			models: [model],
		},
		model,
		config,
		telemetry: { capture } as unknown as ITelemetryService,
	} as unknown as GatewayProviderContext;

	const startedAt = performance.now();
	const events = await collect(await provider.stream(request, context));
	return {
		fetchMock,
		capture,
		events,
		elapsedMs: performance.now() - startedAt,
	};
}

describe("stream retry backoff over the OpenAI-compatible wire format", () => {
	it("holds the SDK's re-dial for the backoff and streams the retry", async () => {
		const emitStatusNotice = vi.fn();
		const { fetchMock, events, elapsedMs } = await run({
			bodies: [overloadedSse, textSse],
			emitStatusNotice,
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(emitStatusNotice).toHaveBeenCalledTimes(1);
		expect(emitStatusNotice).toHaveBeenCalledWith(
			"provider error — retrying in 1s (attempt 1/3)",
			expect.objectContaining({ kind: "stream_retry", delayMs: 1000 }),
		);
		expect(elapsedMs).toBeGreaterThanOrEqual(900);
		expect(
			events.some(
				(event) => event.type === "text-delta" && event.text.includes("hello"),
			),
		).toBe(true);
		const finish = events.find((event) => event.type === "finish");
		expect(finish).toMatchObject({ requestId: "request-2" });
		expect(finish).not.toMatchObject({ reason: "error" });
	});

	it("ends promptly when the request is cancelled during the wait", async () => {
		const controller = new AbortController();
		const emitStatusNotice = vi.fn(() => controller.abort());
		const { fetchMock, capture, events, elapsedMs } = await run({
			bodies: [overloadedSse, textSse],
			signal: controller.signal,
			emitStatusNotice,
		});

		expect(emitStatusNotice).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(elapsedMs).toBeLessThan(900);
		expect(events.some((event) => event.type === "text-delta")).toBe(false);
		expect(events.at(-1)?.type).toBe("finish");
		expect(capture).not.toHaveBeenCalledWith(
			expect.objectContaining({ event: "sdk.error" }),
		);
	});
});
