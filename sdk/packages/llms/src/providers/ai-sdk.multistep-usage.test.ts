import type { AgentModelEvent, GatewayProviderConfig } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClineProvider } from "./ai-sdk";
import { createGateway } from "./gateway";

interface WireUsage {
	prompt_tokens: number;
	completion_tokens: number;
	prompt_tokens_details: { cached_tokens: number; cache_write_tokens: number };
	completion_tokens_details?: { reasoning_tokens: number };
	cost?: number;
}

const firstStep: WireUsage = {
	prompt_tokens: 10_000,
	completion_tokens: 100,
	prompt_tokens_details: { cached_tokens: 8_000, cache_write_tokens: 2_000 },
	cost: 0.01,
};
const secondStep: WireUsage = {
	prompt_tokens: 12_000,
	completion_tokens: 200,
	prompt_tokens_details: { cached_tokens: 9_000, cache_write_tokens: 3_000 },
	cost: 0.02,
};
const pricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

async function runSearch(
	usages: WireUsage[],
	{
		providerId = "cline",
		modelId = "anthropic/claude-sonnet-4.6",
		modelPricing = pricing,
	}: {
		providerId?: string;
		modelId?: string;
		modelPricing?: typeof pricing | null;
	} = {},
) {
	let modelCalls = 0;
	const paths: string[] = [];
	// Only the transport is replaced: the gateway, Cline tools, AI SDK step
	// loop, provider serializers and usage normalizer are the real code.
	const offlineFetch: typeof fetch = async (input) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.origin !== "https://offline.invalid") {
			throw new Error(`Unexpected request: ${url}`);
		}
		paths.push(url.pathname);
		if (url.pathname === "/api/v1/search/websearch") {
			return Response.json({
				data: {
					results: [{ title: "Local result", url: "https://example.invalid" }],
				},
			});
		}
		if (
			url.pathname !== "/api/v1/chat/completions" ||
			modelCalls >= usages.length
		) {
			throw new Error(`Unexpected model request: ${url}`);
		}
		const step = modelCalls++;
		const searching = step < usages.length - 1;
		const frame = (choices: unknown[], usage?: WireUsage) => ({
			id: `completion-${step}`,
			object: "chat.completion.chunk",
			created: 1,
			model: modelId,
			choices,
			...(usage ? { usage } : {}),
		});
		const delta = searching
			? {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: `search-${step}`,
							type: "function",
							function: {
								name: "web_search",
								arguments: '{"query":"offline search"}',
							},
						},
					],
				}
			: { role: "assistant", content: "Local answer" };
		const frames = [
			frame([{ index: 0, delta, finish_reason: null }]),
			frame([
				{
					index: 0,
					delta: {},
					finish_reason: searching ? "tool_calls" : "stop",
				},
			]),
			frame([], usages[step]),
		];
		return new Response(
			frames.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("") +
				"data: [DONE]\n\n",
			{ headers: { "content-type": "text/event-stream" } },
		);
	};
	const gateway = createGateway({
		builtins: false,
		fetch: offlineFetch,
		providers: [
			{
				manifest: {
					id: providerId,
					name: "Offline Cline",
					defaultModelId: modelId,
					models: [
						{
							id: modelId,
							name: modelId,
							providerId,
							metadata: modelPricing ? { pricing: modelPricing } : {},
						},
					],
					modelToolCapabilities: [{ name: "web_search" }],
				},
				createProvider: createClineProvider,
			},
		],
		providerConfigs: [
			{
				providerId,
				apiKey: "offline-test-token",
				baseUrl: "https://offline.invalid/api/v1",
			} satisfies GatewayProviderConfig,
		],
	});
	const events: AgentModelEvent[] = [];
	for await (const event of await gateway.stream({
		providerId,
		modelId,
		messages: [
			{
				id: "user-1",
				role: "user",
				content: [{ type: "text", text: "Search locally" }],
				createdAt: 0,
			},
		],
		modelTools: [{ name: "web_search" }],
		maxTokens: 512,
	})) {
		events.push(event);
	}
	expect(events.filter((event) => event.type === "usage")).toHaveLength(1);
	expect(events.at(-1)).toMatchObject({ type: "finish", reason: "stop" });
	const usage = events.find((event) => event.type === "usage");
	if (usage?.type !== "usage") throw new Error("Missing usage event");
	return { usage: usage.usage, events, paths };
}

describe("Cline multi-step usage", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", async () => {
			throw new Error("Unexpected network request");
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it("preserves provider charges and cache writes across internal web-search steps", async () => {
		const result = await runSearch([firstStep, secondStep]);
		expect(result.paths).toEqual([
			"/api/v1/chat/completions",
			"/api/v1/search/websearch",
			"/api/v1/chat/completions",
		]);
		expect(result.events).toContainEqual({
			type: "text-delta",
			text: "Local answer",
		});
		expect(result.usage).toEqual({
			inputTokens: 22_000,
			outputTokens: 300,
			cacheReadTokens: 17_000,
			cacheWriteTokens: 5_000,
			totalCost: 0.03,
		});
	});

	it("keeps explicit zero charges instead of estimating each step", async () => {
		const { usage } = await runSearch([
			{ ...firstStep, cost: 0 },
			{ ...secondStep, cost: 0 },
		]);
		expect(usage.totalCost).toBe(0);
	});

	it.each([
		{
			description: "last",
			usages: [firstStep, { ...secondStep, cost: undefined }],
			expectedCost: 0.02695,
		},
		{
			description: "first",
			usages: [{ ...firstStep, cost: undefined }, secondStep],
			expectedCost: 0.0314,
		},
	])("estimates only the $description step when its provider charge is absent", async ({
		usages,
		expectedCost,
	}) => {
		const { usage } = await runSearch(usages);
		expect(usage.totalCost).toBeCloseTo(expectedCost, 10);
		expect(usage.cacheWriteTokens).toBe(5_000);
	});

	it("separates reasoning once while retaining all billed output", async () => {
		const { usage } = await runSearch([
			{
				...firstStep,
				cost: undefined,
				completion_tokens_details: { reasoning_tokens: 20 },
			},
			{
				...secondStep,
				cost: undefined,
				completion_tokens_details: { reasoning_tokens: 30 },
			},
		]);
		expect(usage).toMatchObject({
			inputTokens: 22_000,
			outputTokens: 250,
			reasoningTokenCount: 50,
		});
		expect(usage.totalCost).toBeCloseTo(0.02835, 10);
	});

	it.each([
		[firstStep, { ...secondStep, cost: undefined }],
		[{ ...firstStep, cost: undefined }, secondStep],
	])("does not present partial known charges as the total without fallback pricing: %j", async (...usages) => {
		const { usage } = await runSearch(usages, { modelPricing: null });
		expect(usage).not.toHaveProperty("totalCost");
		expect(usage.inputTokens).toBe(22_000);
	});

	it.each([
		{ providerId: "cline-pass" },
		{ modelId: "cline-pass/included-model" },
		{ modelId: "cline-free/free-model" },
		{ modelId: "vendor/model:free" },
		{ modelPricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
	])("keeps included/free multi-step charges at zero: %j", async (selection) => {
		const { usage } = await runSearch([firstStep, secondStep], selection);
		expect(usage.totalCost).toBe(0);
		expect(usage.cacheWriteTokens).toBe(5_000);
	});

	it("retains raw usage for a single model step", async () => {
		const { usage, paths } = await runSearch([secondStep]);
		expect(paths).toEqual(["/api/v1/chat/completions"]);
		expect(usage).toEqual({
			inputTokens: 12_000,
			outputTokens: 200,
			cacheReadTokens: 9_000,
			cacheWriteTokens: 3_000,
			totalCost: 0.02,
		});
	});
});
