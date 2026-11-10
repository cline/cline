import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
	ModelReasoningOption,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleProvider } from "./ai-sdk";
import { MODEL_STREAM_IDLE_TIMEOUT_ENV } from "./http";

/**
 * Wire-level tests for Gemini: they drive the real `@ai-sdk/google` adapter
 * and the real `ai` package against a fake fetch, so the request body the
 * Gemini API would receive is what gets asserted. Reasoning levels are owned
 * by the AI SDK's portable `reasoning` option, which the adapter turns into
 * `thinkingLevel` (Gemini 3 and later) or `thinkingBudget` (Gemini 2.5).
 */

const BUDGET_25_FLASH: ModelReasoningOption[] = [
	{ type: "toggle" },
	{ type: "budget_tokens", min: 0, max: 24_576 },
];
const LEVELS: ModelReasoningOption[] = [
	{ type: "effort", values: ["low", "medium", "high"] },
];

const textSse = `data: ${JSON.stringify({
	candidates: [
		{
			content: { role: "model", parts: [{ text: "hello" }] },
			finishReason: "STOP",
		},
	],
	usageMetadata: {
		promptTokenCount: 1,
		candidatesTokenCount: 1,
		totalTokenCount: 2,
	},
})}\n\n`;

async function collect(
	iterable: AsyncIterable<AgentModelEvent>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of iterable) {
		events.push(event);
	}
	return events;
}

function providerContext(
	modelId: string,
	config: Record<string, unknown>,
	reasoningOptions?: ModelReasoningOption[],
): GatewayProviderContext {
	const model = {
		id: modelId,
		providerId: "gemini",
		name: modelId,
		capabilities: ["reasoning"],
		...(reasoningOptions ? { reasoningOptions } : {}),
	};
	return {
		provider: {
			id: "gemini",
			name: "Google Gemini",
			defaultModelId: modelId,
			models: [model],
		},
		model,
		config,
	} as unknown as GatewayProviderContext;
}

function streamRequest(
	modelId: string,
	reasoning: GatewayStreamRequest["reasoning"],
): GatewayStreamRequest {
	return {
		providerId: "gemini",
		modelId,
		messages: [
			{
				id: "msg_user",
				role: "user",
				content: [{ type: "text", text: "do the thing" }],
				createdAt: new Date(),
			},
		],
		reasoning,
	} as unknown as GatewayStreamRequest;
}

async function run(input: {
	modelId: string;
	reasoning?: GatewayStreamRequest["reasoning"];
	reasoningOptions?: ModelReasoningOption[];
	fetch?: typeof fetch;
}) {
	const fetchMock = vi.fn(
		input.fetch ??
			(async () =>
				new Response(textSse, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				})),
	);
	const config = {
		providerId: "gemini",
		apiKey: "test-key",
		fetch: fetchMock as unknown as typeof fetch,
	};
	const provider = await createGoogleProvider(config);
	const events = await collect(
		await provider.stream(
			streamRequest(input.modelId, input.reasoning),
			providerContext(input.modelId, config, input.reasoningOptions),
		),
	);
	const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
	const body =
		typeof init?.body === "string"
			? (JSON.parse(init.body) as {
					generationConfig?: { thinkingConfig?: Record<string, unknown> };
				})
			: undefined;
	return {
		events,
		fetchMock,
		thinkingConfig: body?.generationConfig?.thinkingConfig,
	};
}

describe("Gemini reasoning on the wire", () => {
	it("sends a thinking level, never a budget, to an unlisted newer Gemini model", async () => {
		const { events, thinkingConfig } = await run({
			modelId: "gemini-example-next-eap",
			reasoning: { enabled: true, effort: "high" },
		});

		expect(thinkingConfig).toEqual({ thinkingLevel: "high" });
		expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
	});

	it("drops an exact token budget for a model that takes thinking levels", async () => {
		const { thinkingConfig } = await run({
			modelId: "gemini-4-argon",
			reasoning: { enabled: true, budgetTokens: 4096 },
			reasoningOptions: [
				...LEVELS,
				{ type: "budget_tokens", min: 0, max: 32_768 },
			],
		});

		expect(thinkingConfig).not.toHaveProperty("thinkingBudget");
	});

	it("sends a thinking level to Gemini 3", async () => {
		const { thinkingConfig } = await run({
			modelId: "gemini-3-pro-preview",
			reasoning: { enabled: true, effort: "low" },
			reasoningOptions: LEVELS,
		});

		expect(thinkingConfig).toEqual({ thinkingLevel: "low" });
	});

	it("lets the AI SDK derive a thinking budget for Gemini 2.5 effort", async () => {
		const { thinkingConfig } = await run({
			modelId: "gemini-2.5-flash",
			reasoning: { enabled: true, effort: "high" },
			reasoningOptions: BUDGET_25_FLASH,
		});

		expect(thinkingConfig).not.toHaveProperty("thinkingLevel");
		expect(thinkingConfig?.thinkingBudget).toBeGreaterThan(0);
		expect(thinkingConfig?.thinkingBudget).toBeLessThanOrEqual(24_576);
	});

	it("keeps an exact token budget for Gemini 2.5", async () => {
		const { thinkingConfig } = await run({
			modelId: "gemini-2.5-flash",
			reasoning: { enabled: true, budgetTokens: 4096 },
			reasoningOptions: BUDGET_25_FLASH,
		});

		expect(thinkingConfig).toEqual({
			thinkingBudget: 4096,
			includeThoughts: true,
		});
	});

	it("turns thinking off for Gemini 2.5 Flash", async () => {
		const { thinkingConfig } = await run({
			modelId: "gemini-2.5-flash",
			reasoning: { enabled: false },
			reasoningOptions: BUDGET_25_FLASH,
		});

		expect(thinkingConfig).toEqual({ thinkingBudget: 0 });
	});

	it("sends no thinking config without reasoning intent", async () => {
		const { thinkingConfig } = await run({ modelId: "gemini-2.5-flash" });

		expect(thinkingConfig).toBeUndefined();
	});
});

/** The fetch-level timeouts only apply under Bun, so tests pose as it. */
function stubBunRuntime(): void {
	Object.defineProperty(process.versions, "bun", {
		value: "1.4.2",
		configurable: true,
	});
}

function unstubBunRuntime(): void {
	delete (process.versions as { bun?: string }).bun;
}

describe("Gemini stream stall timeout", () => {
	beforeEach(stubBunRuntime);
	afterEach(() => {
		unstubBunRuntime();
		vi.unstubAllEnvs();
	});

	const sseResponse = (
		init: RequestInit | undefined,
		firstChunk?: string,
	): Response =>
		new Response(
			new ReadableStream({
				start(controller) {
					if (firstChunk) {
						controller.enqueue(new TextEncoder().encode(firstChunk));
					}
					init?.signal?.addEventListener("abort", () =>
						controller.error(init.signal?.reason),
					);
				},
			}),
			{ status: 200, headers: { "content-type": "text/event-stream" } },
		);

	const partialSse = `data: ${JSON.stringify({
		candidates: [{ content: { role: "model", parts: [{ text: "hel" }] } }],
	})}\n\n`;

	it.each([
		[
			"never returns headers",
			((_input: unknown, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(init.signal?.reason),
					);
				})) as unknown as typeof fetch,
		],
		[
			"returns headers and then no content",
			(async (_input: unknown, init?: RequestInit) =>
				sseResponse(init)) as unknown as typeof fetch,
		],
		[
			"stalls after its first content chunk",
			(async (_input: unknown, init?: RequestInit) =>
				sseResponse(init, partialSse)) as unknown as typeof fetch,
		],
	])("ends a request that %s with a retryable timeout error", async (_name, stalledFetch) => {
		vi.stubEnv(MODEL_STREAM_IDLE_TIMEOUT_ENV, "40");

		const { events } = await run({
			modelId: "gemini-example-next-eap",
			fetch: stalledFetch,
		});

		const finish = events.at(-1);
		expect(finish).toMatchObject({
			type: "finish",
			reason: "error",
			errorRetryable: true,
		});
		expect((finish as { error?: string }).error).toMatch(/time/i);
	});
});

describe("dedicated image generation", () => {
	beforeEach(stubBunRuntime);
	afterEach(() => {
		unstubBunRuntime();
		vi.unstubAllEnvs();
	});

	it("keeps the runtime's fetch timeout instead of the stream stall limits", async () => {
		vi.stubEnv(MODEL_STREAM_IDLE_TIMEOUT_ENV, "40");
		const inits: Array<RequestInit | undefined> = [];
		const pendingFetch = vi.fn(
			(_input: unknown, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					inits.push(init);
					init?.signal?.addEventListener("abort", () =>
						reject(init.signal?.reason),
					);
				}),
		);
		const config = {
			providerId: "gemini",
			apiKey: "test-key",
			fetch: pendingFetch as unknown as typeof fetch,
		};
		const context = providerContext("gemini-example-image", config);
		(context.model as { operation?: string }).operation = "image-generation";
		const caller = new AbortController();
		const provider = await createGoogleProvider(config);
		const pending = collect(
			await provider.stream(
				{
					...streamRequest("gemini-example-image", undefined),
					signal: caller.signal,
				},
				context,
			),
		);

		// Well past the 40ms stall limit: the request is still open, and the
		// fetch was not asked to drop the runtime's own idle timeout.
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(pendingFetch).toHaveBeenCalledTimes(1);
		expect(inits[0]?.signal?.aborted).toBe(false);
		expect(inits[0]).not.toHaveProperty("timeout");

		caller.abort();
		await pending;
	});
});
