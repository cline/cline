import type { AgentMessage, AgentModelEvent } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeModelsDevProviderModels } from "../catalog/catalog-live";
import { createGateway } from "./gateway";

const streamTextSpy = vi.fn();
const openaiCompatibleFactorySpy = vi.fn();
const openaiCompatibleSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "openai-compatible",
}));
const openaiResponsesSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "openai",
}));
const anthropicSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "anthropic",
}));
const googleSpy = vi.fn((modelId: string) => ({ modelId, family: "google" }));
const codexExecFactorySpy = vi.fn();
const codexExecSpy = vi.fn((modelId: string) => ({
	modelId,
	family: "openai-codex",
}));

vi.mock("ai", () => ({
	jsonSchema: (schema: unknown, options: unknown) => ({
		jsonSchema: schema,
		...(options && typeof options === "object" ? options : {}),
	}),
	streamText: (input: unknown) => streamTextSpy(input),
	// `wrapLanguageModel` is used by the openai-compatible and mistral
	// vendors to attach `splitToolImagesMiddleware`. The middleware itself
	// is exercised by its own unit tests; here we just need an identity
	// pass-through so the vendor factories' downstream `model:` callbacks
	// keep returning the spy-produced mock objects unchanged. (The mock
	// objects don't satisfy the real `LanguageModelV3` interface, so we
	// can't call the real `wrapLanguageModel` either way.)
	wrapLanguageModel: ({ model }: { model: unknown }) => model,
}));

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: () => ({
		responses: (modelId: string) => openaiResponsesSpy(modelId),
	}),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: (config: unknown) => {
		openaiCompatibleFactorySpy(config);
		return (modelId: string) => openaiCompatibleSpy(modelId);
	},
}));

vi.mock("@ai-sdk/anthropic", () => ({
	createAnthropic: () => (modelId: string) => anthropicSpy(modelId),
}));

vi.mock("@ai-sdk/google", () => ({
	createGoogleGenerativeAI: () => (modelId: string) => googleSpy(modelId),
}));

vi.mock("ai-sdk-provider-codex-cli", () => ({
	createCodexExec: (config: unknown) => {
		codexExecFactorySpy(config);
		return (modelId: string) => codexExecSpy(modelId);
	},
}));

async function* makeStreamParts(parts: unknown[]) {
	for (const part of parts) {
		yield part;
	}
}

async function* makeFailingStreamParts(error: unknown, parts: unknown[] = []) {
	for (const part of parts) {
		yield part;
	}
	throw error;
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

const baseMessages: AgentMessage[] = [
	{
		id: "user_1",
		role: "user",
		content: [{ type: "text", text: "Hello" }],
		createdAt: Date.now(),
	},
];
const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;

describe("sdk-gateway", () => {
	beforeEach(() => {
		streamTextSpy.mockReset();
		openaiCompatibleFactorySpy.mockReset();
		openaiCompatibleSpy.mockReset();
		openaiResponsesSpy.mockReset();
		anthropicSpy.mockReset();
		googleSpy.mockReset();
		codexExecFactorySpy.mockReset();
		codexExecSpy.mockReset();
		googleSpy.mockImplementation((modelId: string) => ({
			modelId,
			family: "google",
		}));
		openaiCompatibleSpy.mockImplementation((modelId: string) => ({
			modelId,
			family: "openai-compatible",
		}));
		openaiResponsesSpy.mockImplementation((modelId: string) => ({
			modelId,
			family: "openai",
		}));
		anthropicSpy.mockImplementation((modelId: string) => ({
			modelId,
			family: "anthropic",
		}));
		codexExecSpy.mockImplementation((modelId: string) => ({
			modelId,
			family: "openai-codex",
		}));
		if (originalOpenRouterApiKey === undefined) {
			delete process.env.OPENROUTER_API_KEY;
		} else {
			process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
		}
	});

	it("keeps custom provider loading lazy until first use", async () => {
		const createProvider = vi.fn(() => ({
			async *stream() {
				yield { type: "text-delta", text: "lazy" } satisfies AgentModelEvent;
				yield { type: "finish", reason: "stop" } satisfies AgentModelEvent;
			},
		}));
		const loadProvider = vi.fn(async () => ({ createProvider }));
		const gateway = createGateway({
			builtins: false,
			providers: [
				{
					manifest: {
						id: "custom",
						name: "Custom",
						defaultModelId: "alpha",
						models: [{ id: "alpha", name: "Alpha", providerId: "custom" }],
					},
					loadProvider,
				},
			],
		});

		expect(loadProvider).not.toHaveBeenCalled();
		const events = await collect(
			await gateway.stream({
				providerId: "custom",
				modelId: "alpha",
				messages: baseMessages,
			}),
		);

		expect(loadProvider).toHaveBeenCalledOnce();
		expect(createProvider).toHaveBeenCalledOnce();
		expect(events).toContainEqual({ type: "text-delta", text: "lazy" });
	});

	it("exposes old-provider-style builtins with generated manifests", () => {
		const gateway = createGateway();
		const providerIds = gateway.listProviders().map((provider) => provider.id);

		expect(providerIds).toContain("openai-native");
		expect(providerIds).toContain("anthropic");
		expect(providerIds).toContain("gemini");
		expect(providerIds).toContain("vertex");
		expect(providerIds).toContain("bedrock");
		expect(providerIds).toContain("openrouter");
		expect(providerIds).toContain("aihubmix");
		expect(providerIds).toContain("claude-code");
		expect(providerIds).toContain("openai-codex");

		const aihubmix = gateway
			.listProviders()
			.find((provider) => provider.id === "aihubmix");
		expect(aihubmix?.metadata).toMatchObject({
			promptCacheStrategy: "anthropic-automatic",
		});
	});

	it("keeps anthropic-automatic prompt cache strategy on the expected remapped provider set", () => {
		const gateway = createGateway();
		const strategyProviders = gateway
			.listProviders()
			.filter(
				(provider) =>
					provider.metadata?.promptCacheStrategy === "anthropic-automatic",
			)
			.map((provider) => provider.id)
			.sort();

		expect(strategyProviders).toEqual([
			"aihubmix",
			"anthropic",
			"bedrock",
			"cline",
			"minimax",
			"oca",
			"openrouter",
			"qwen",
			"qwen-code",
			"sapaicore",
			"vercel-ai-gateway",
			"vertex",
		]);
	});

	it("adapts OpenAI Responses streams through the native AI SDK provider", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "text-delta", textDelta: "Hello from OpenAI" },
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "lookup",
					input: { term: "sdk" },
				},
				{
					type: "finish",
					finishReason: "tool-calls",
					usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 2 },
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-native",
					apiKey: "test",
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openai-native",
				modelId: "gpt-5-mini",
				messages: baseMessages,
				tools: [
					{
						name: "lookup",
						description: "Lookup a term",
						inputSchema: { type: "object" },
					},
				],
			}),
		);

		expect(openaiResponsesSpy).toHaveBeenCalledWith("gpt-5-mini");
		expect(events).toContainEqual({
			type: "text-delta",
			text: "Hello from OpenAI",
		});
		expect(events).toContainEqual({
			type: "tool-call-delta",
			toolCallId: "call_1",
			toolName: "lookup",
			input: { term: "sdk" },
			inputText: '{"term":"sdk"}',
			metadata: {
				toolSource: {
					providerId: "openai-native",
					modelId: "gpt-5-mini",
					executionMode: "runtime",
				},
			},
		});
		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 10,
				outputTokens: 4,
				cacheReadTokens: 2,
				cacheWriteTokens: 0,
			}),
		});
		expect(events.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
	});

	it("surfaces nested AI SDK stream errors as human-readable finish messages", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeFailingStreamParts(
				new Error("No output generated. Check the stream for errors.", {
					cause: new Error("Invalid API key"),
				}),
			),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-native",
					apiKey: "test",
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openai-native",
				modelId: "gpt-5-mini",
				messages: baseMessages,
			}),
		);

		expect(events.at(-1)).toEqual({
			type: "finish",
			reason: "error",
			error: "Invalid API key",
		});
	});

	it("does not wait for usage when an AI SDK stream emits an error part", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "error",
					error: new Error("Invalid API key"),
				},
			]),
			usage: new Promise(() => {}),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-native",
					apiKey: "test",
				},
			],
		});

		const events = await Promise.race([
			collect(
				await gateway.stream({
					providerId: "openai-native",
					modelId: "gpt-5-mini",
					messages: baseMessages,
				}),
			),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timed out waiting for stream")), 50),
			),
		]);

		expect(events).toEqual([
			{
				type: "finish",
				reason: "error",
				error: "Invalid API key",
			},
		]);
	});

	it("surfaces API detail fields from OpenAI-compatible error bodies", async () => {
		const apiError = Object.assign(new Error("Bad Request"), {
			statusCode: 400,
			responseBody: JSON.stringify({
				detail: "Instructions are required",
			}),
		});
		streamTextSpy.mockReturnValue({
			fullStream: makeFailingStreamParts(apiError),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-native",
					apiKey: "test",
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openai-native",
				modelId: "gpt-5-mini",
				messages: baseMessages,
			}),
		);

		expect(events.at(-1)).toEqual({
			type: "finish",
			reason: "error",
			error: "Instructions are required",
		});
	});

	it("passes user file blocks through as text content", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-native",
					apiKey: "test",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-native",
				modelId: "gpt-5-mini",
				messages: [
					{
						id: "user_1",
						role: "user",
						content: [
							{ type: "text", text: "Check the file." },
							{
								type: "file",
								path: "/workspace/AGENTS.md",
								content: "rules go here",
							},
						],
						createdAt: Date.now(),
					},
				],
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "Check the file." },
							{
								type: "text",
								text: '<file_content path="/workspace/AGENTS.md">\nrules go here\n</file_content>',
							},
						],
					},
				],
			}),
		);
	});

	it("passes user image blocks through the openai-compatible ai-sdk path", async () => {
		process.env.OPENROUTER_API_KEY = "env-openrouter-key";
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway();

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-haiku-4.5",
				messages: [
					{
						id: "user_1",
						role: "user",
						content: [
							{ type: "text", text: "whats in the pic" },
							{
								type: "image",
								mediaType: "image/png",
								image: "data:image/png;base64,aGVsbG8=",
							},
						],
						createdAt: Date.now(),
					},
				],
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "text",
								text: "whats in the pic",
							}),
							expect.objectContaining({
								type: "image",
								image: "data:image/png;base64,aGVsbG8=",
								mediaType: "image/png",
							}),
						]),
					}),
				]),
			}),
		);
	});

	it("reads Anthropic cache usage from provider metadata", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					finishReason: "tool-calls",
					usage: {
						prompt_tokens: 10091,
						completion_tokens: 87,
						cache_creation_input_tokens: 2770,
					},
					providerMetadata: {
						anthropic: {
							usage: {
								input_tokens: 3,
								output_tokens: 87,
								cache_creation_input_tokens: 2770,
								cache_read_input_tokens: 7318,
							},
						},
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "anthropic-key",
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 10091,
				outputTokens: 87,
				cacheReadTokens: 7318,
				cacheWriteTokens: 2770,
			}),
		});
		expect(events.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
	});

	it("reads cache usage from nested prompt token details", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 9125,
						completion_tokens: 96,
						prompt_tokens_details: {
							cached_tokens: 8885,
						},
						cache_creation_input_tokens: 237,
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "anthropic-key",
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 9125,
				outputTokens: 96,
				cacheReadTokens: 8885,
				cacheWriteTokens: 237,
			}),
		});
		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
	});

	it("preserves usage cost from market cost fields", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 3793,
						completion_tokens: 1250,
						cost: 0,
						market_cost: 0.01829135,
					},
					providerMetadata: {
						gateway: {
							cost: "0.01829135",
							marketCost: "0.01829135",
						},
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "cline-key",
					models: [
						{
							id: "openai/gpt-5.4",
							name: "GPT-5.4",
							metadata: {
								pricing: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "openai/gpt-5.4",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: {
				inputTokens: 3793,
				outputTokens: 1250,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0.01829135,
			},
		});
	});

	it("preserves explicit zero cost instead of falling back to catalog pricing", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 1000,
						completion_tokens: 200,
						cost: 0,
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
					defaultModelId: "priced-model",
					models: [
						{
							id: "priced-model",
							name: "Priced Model",
							metadata: {
								pricing: {
									input: 2,
									output: 8,
								},
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "priced-model",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				totalCost: 0,
			}),
		});
	});

	it("falls back to catalog pricing when upstream cost is missing", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 1000,
						completion_tokens: 200,
						cache_read_input_tokens: 100,
						cache_creation_input_tokens: 50,
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
					defaultModelId: "priced-model",
					models: [
						{
							id: "priced-model",
							name: "Priced Model",
							metadata: {
								pricing: {
									input: 2,
									output: 8,
									cacheRead: 0.5,
								},
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "priced-model",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 1000,
				outputTokens: 200,
				cacheReadTokens: 100,
				cacheWriteTokens: 50,
			}),
		});
		const usageEvent = events.find(
			(event): event is Extract<AgentModelEvent, { type: "usage" }> =>
				event.type === "usage",
		);
		expect(usageEvent?.usage.totalCost).toBeCloseTo(0.003475, 12);
	});

	it("reads nested raw market cost for cline before falling back to pricing", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 3793,
						completion_tokens: 1250,
						raw: {
							cost: 0,
							market_cost: 0.01829135,
						},
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "cline-key",
					models: [
						{
							id: "openai/gpt-5.4",
							name: "GPT-5.4",
							metadata: {
								pricing: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "openai/gpt-5.4",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				totalCost: 0.01829135,
			}),
		});
	});

	it("uses nested raw upstream inference cost for vercel ai gateway", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 24553,
						completion_tokens: 32,
						raw: {
							cost: 0,
							cost_details: {
								upstream_inference_cost: 0.0123725,
							},
						},
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "vercel-ai-gateway",
					apiKey: "vercel-key",
					models: [
						{
							id: "google/gemini-3-flash",
							name: "Gemini 3 Flash",
							metadata: {
								pricing: { input: 9, output: 9 },
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "vercel-ai-gateway",
				modelId: "google/gemini-3-flash",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				totalCost: 0.0123725,
			}),
		});
	});

	it("uses provider-specific openrouter billed total from nested raw usage", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 24559,
						completion_tokens: 31,
						raw: {
							cost: 0.000618625,
							cost_details: {
								upstream_inference_cost: 0.0123725,
							},
						},
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
					defaultModelId: "google/gemini-3-flash-preview",
					models: [
						{
							id: "google/gemini-3-flash-preview",
							name: "Gemini 3 Flash Preview",
							metadata: {
								pricing: { input: 9, output: 9 },
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "google/gemini-3-flash-preview",
				messages: baseMessages,
			}),
		);

		const usageEvent = events.find(
			(event): event is Extract<AgentModelEvent, { type: "usage" }> =>
				event.type === "usage",
		);
		expect(usageEvent?.usage.totalCost).toBeCloseTo(0.012991125, 12);
	});

	it("applies provider-specific usage normalization to stream usage promises", async () => {
		streamTextSpy.mockReturnValue({
			usage: Promise.resolve({
				inputTokens: 24553,
				outputTokens: 32,
				raw: {
					cost: 0,
					cost_details: {
						upstream_inference_cost: 0.0123725,
					},
				},
			}),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "vercel-ai-gateway",
					apiKey: "vercel-key",
					models: [
						{
							id: "google/gemini-3-flash",
							name: "Gemini 3 Flash",
							metadata: {
								pricing: { input: 9, output: 9 },
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "vercel-ai-gateway",
				modelId: "google/gemini-3-flash",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 24553,
				outputTokens: 32,
				totalCost: 0.0123725,
			}),
		});
	});

	it("does not emit duplicate usage when finish parts already carry totals", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 1000,
						completion_tokens: 25,
						cache_creation_input_tokens: 50,
						prompt_tokens_details: { cached_tokens: 200 },
						market_cost: 0.0011,
					},
				},
			]),
			usage: Promise.resolve({
				prompt_tokens: 1000,
				completion_tokens: 25,
				cache_creation_input_tokens: 50,
				prompt_tokens_details: { cached_tokens: 200 },
				market_cost: 0.0011,
			}),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "cline-key",
					models: [{ id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" }],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "openai/gpt-5.3-codex",
				messages: baseMessages,
			}),
		);

		const usageEvents = events.filter(
			(event): event is Extract<AgentModelEvent, { type: "usage" }> =>
				event.type === "usage",
		);
		expect(usageEvents).toHaveLength(1);
		expect(usageEvents[0]).toEqual({
			type: "usage",
			usage: {
				inputTokens: 1000,
				outputTokens: 25,
				cacheReadTokens: 200,
				cacheWriteTokens: 50,
				totalCost: 0.0011,
			},
		});
	});

	it("reads cache write tokens from nested raw usage", async () => {
		streamTextSpy.mockReturnValue({
			usage: Promise.resolve({
				inputTokens: 15997,
				outputTokens: 4,
				raw: {
					prompt_tokens: 15997,
					completion_tokens: 4,
					cache_creation_input_tokens: 22,
					market_cost: 0.0082385,
				},
			}),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "cline-key",
					models: [
						{
							id: "anthropic/claude-opus-4.6",
							name: "Claude Opus 4.6",
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "anthropic/claude-opus-4.6",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 15997,
				outputTokens: 4,
				cacheWriteTokens: 22,
				totalCost: 0.0082385,
			}),
		});
	});

	it("reads compatible-provider cache usage from nested provider metadata", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 10091,
						completion_tokens: 87,
						cache_creation_input_tokens: 2770,
					},
					providerMetadata: {
						openrouter: {
							usage: {
								input_tokens: 3,
								output_tokens: 87,
								cache_creation_input_tokens: 2770,
								cache_read_input_tokens: 7318,
							},
						},
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-4.6",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 10091,
				outputTokens: 87,
				cacheReadTokens: 7318,
				cacheWriteTokens: 2770,
			}),
		});
	});

	it("prefers LanguageModelUsage inputTokenDetails cache reads", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						inputTokens: 50,
						outputTokens: 10,
						inputTokenDetails: {
							cacheReadTokens: 12,
						},
						cachedInputTokens: 4,
					},
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "anthropic-key",
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				messages: baseMessages,
			}),
		);

		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				inputTokens: 50,
				outputTokens: 10,
				cacheReadTokens: 12,
				cacheWriteTokens: 0,
			}),
		});
	});

	it("formats assistant tool calls and tool results into valid AI SDK messages", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "text-delta", textDelta: "done" },
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "anthropic-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				messages: [
					{
						id: "user_1",
						role: "user",
						content: [{ type: "text", text: "hey" }],
						createdAt: Date.now(),
					},
					{
						id: "assistant_1",
						role: "assistant",
						content: [
							{ type: "text", text: "Let me inspect that." },
							{
								type: "tool-call",
								toolCallId: "call_1",
								toolName: "run_commands",
								input: { commands: ["pwd"] },
							},
						],
						createdAt: Date.now(),
					},
					{
						id: "user_2",
						role: "user",
						content: [
							{
								type: "tool-result",
								toolCallId: "call_1",
								toolName: "run_commands",
								output: { ok: true },
							},
						],
						createdAt: Date.now(),
					},
				],
				tools: [
					{
						name: "run_commands",
						description: "Runs shell commands",
						inputSchema: { type: "object" },
					},
				],
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({ type: "text", text: "hey" }),
						]),
					}),
					{
						role: "assistant",
						content: [
							{ type: "text", text: "Let me inspect that." },
							{
								type: "tool-call",
								toolCallId: "call_1",
								toolName: "run_commands",
								input: { commands: ["pwd"] },
							},
						],
					},
					{
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolCallId: "call_1",
								toolName: "run_commands",
								output: { type: "json", value: { ok: true } },
							},
						],
					},
				],
				tools: expect.objectContaining({
					run_commands: expect.not.objectContaining({
						providerOptions: expect.anything(),
					}),
				}),
			}),
		);
	});

	it("does not pass extra tools to providers that disable external tool execution", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "openai-codex-cli" }],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-codex-cli",
				modelId: "gpt-5.3-codex",
				messages: baseMessages,
				tools: [
					{
						name: "run_commands",
						description: "Runs shell commands",
						inputSchema: { type: "object" },
					},
				],
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				tools: undefined,
			}),
		);
	});

	it("tags tool call events with provider metadata for providers that disable external tool execution", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "run_commands",
					input: { cmd: "pwd" },
				},
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "openai-codex-cli" }],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openai-codex-cli",
				modelId: "gpt-5.3-codex",
				messages: baseMessages,
			}),
		);

		const toolCallEvent = events.find(
			(event) => event.type === "tool-call-delta",
		);
		expect(toolCallEvent).toMatchObject({
			type: "tool-call-delta",
			toolCallId: "call_1",
			toolName: "run_commands",
			input: { cmd: "pwd" },
			inputText: '{"cmd":"pwd"}',
			metadata: {
				toolSource: {
					providerId: "openai-codex-cli",
					modelId: "gpt-5.3-codex",
					executionMode: "provider",
				},
			},
		});
	});

	it("keeps AI SDK tool-error parts recoverable", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "run_commands",
					input: '{"commands": find /workspace | head -20}',
				},
				{
					type: "tool-error",
					toolCallId: "call_1",
					toolName: "run_commands",
					input: '{"commands": find /workspace | head -20}',
					error: "Invalid input for tool run_commands: JSON parsing failed",
				},
				{
					type: "finish",
					finishReason: "tool-calls",
					usage: { inputTokens: 1, outputTokens: 1 },
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "openai-codex-cli" }],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openai-codex-cli",
				modelId: "gpt-5.3-codex",
				messages: baseMessages,
			}),
		);

		const toolCallEvents = events.filter(
			(event): event is Extract<AgentModelEvent, { type: "tool-call-delta" }> =>
				event.type === "tool-call-delta",
		);
		expect(toolCallEvents).toHaveLength(2);
		expect(toolCallEvents[0]).toMatchObject({
			toolCallId: "call_1",
			toolName: "run_commands",
			inputText: '{"commands": find /workspace | head -20}',
		});
		expect(toolCallEvents[1]).toMatchObject({
			toolCallId: "call_1",
			toolName: "run_commands",
			metadata: {
				inputParseError: expect.stringContaining(
					"Invalid input for tool run_commands",
				),
				aiSdkToolError:
					"Invalid input for tool run_commands: JSON parsing failed",
			},
		});
		expect(events.at(-1)).toEqual({
			type: "finish",
			reason: "tool-calls",
			error: undefined,
		});
	});

	it("passes Codex instructions through provider options and removes the system message from messages", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "openai-codex" }],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				systemPrompt: "You are helpful.",
				messages: baseMessages,
				reasoning: {
					effort: "high",
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "Hello" }],
					},
				],
				providerOptions: expect.objectContaining({
					openai: expect.objectContaining({
						instructions: "You are helpful.",
						store: false,
					}),
					"openai-codex": expect.objectContaining({
						store: false,
						reasoningEffort: "high",
						reasoningSummary: "auto",
					}),
					openaiCodex: expect.objectContaining({
						store: false,
					}),
				}),
			}),
		);
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { providerOptions?: Record<string, Record<string, unknown>> }
			| undefined;
		expect(call?.providerOptions?.openai).not.toHaveProperty("truncation");
		expect(call?.providerOptions?.["openai-codex"]).not.toHaveProperty(
			"truncation",
		);
		expect(call?.providerOptions?.openaiCodex).not.toHaveProperty("truncation");
	});

	it("passes object JSON schemas unchanged to the OpenAI Codex tool adapter", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "openai-codex" }],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-codex",
				modelId: "gpt-5.4",
				messages: baseMessages,
				tools: [
					{
						name: "run_commands",
						description: "Runs shell commands",
						inputSchema: {
							type: "object",
							properties: {
								commands: {
									type: "array",
									items: { type: "string" },
								},
							},
							required: ["commands"],
							additionalProperties: false,
						},
					},
				],
			}),
		);

		const call = streamTextSpy.mock.calls[0]?.[0] as
			| { tools?: Record<string, { inputSchema?: { jsonSchema?: unknown } }> }
			| undefined;
		const schema = await call?.tools?.run_commands.inputSchema?.jsonSchema;
		expect(schema).toEqual({
			type: "object",
			properties: {
				commands: {
					type: "array",
					items: { type: "string" },
				},
			},
			required: ["commands"],
			additionalProperties: false,
		});
	});

	it("passes reasoning effort through to Anthropic provider options", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "anthropic-key",
					models: [
						{
							id: "claude-sonnet-4-5",
							name: "Claude Sonnet 4.5",
							metadata: {
								family: "claude-sonnet",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				messages: baseMessages,
				reasoning: {
					effort: "high",
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					anthropic: expect.objectContaining({
						thinking: expect.objectContaining({ type: "enabled" }),
					}),
				}),
			}),
		);
	});

	it("does not enable adaptive thinking for Anthropic when reasoning is not requested", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "anthropic-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					anthropic: expect.not.objectContaining({
						thinking: { type: "adaptive" },
					}),
				}),
			}),
		);
	});

	it("detects anthropic-compatible aliases by family and forwards reasoning plus prompt cache", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
					models: [
						{
							id: "router-claude-alias",
							name: "Router Claude Alias",
							metadata: {
								family: "claude-sonnet",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "router-claude-alias",
				messages: baseMessages,
				maxTokens: 8192,
				reasoning: {
					enabled: true,
					effort: "high",
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "text",
								providerOptions: expect.objectContaining({
									openrouter: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
								}),
							}),
						]),
					}),
				]),
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.objectContaining({
						cache_control: { type: "ephemeral" },
						reasoning: expect.objectContaining({
							enabled: true,
							max_tokens: expect.any(Number),
						}),
					}),
					openrouter: expect.objectContaining({
						cache_control: { type: "ephemeral" },
						reasoning: expect.objectContaining({
							effort: "high",
						}),
					}),
					anthropic: expect.objectContaining({
						cache_control: { type: "ephemeral" },
						thinking: expect.objectContaining({ type: "enabled" }),
					}),
				}),
			}),
		);
	});

	it("keeps OpenRouter Qwen prompt cache on a content part", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
					models: [
						{
							id: "alibaba/qwen3.6-plus",
							name: "Qwen 3.6 Plus",
							metadata: {
								family: "qwen",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "alibaba/qwen3.6-plus",
				messages: baseMessages,
			}),
		);

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { messages?: Array<{ role: string; content: unknown }> }
			| undefined;
		const userMessage = call?.messages?.find(
			(message) => message.role === "user",
		);
		expect(Array.isArray(userMessage?.content)).toBe(true);
		expect(userMessage?.content).toEqual([
			expect.objectContaining({
				type: "text",
				text: "Hello",
				providerOptions: expect.objectContaining({
					openrouter: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					openaiCompatible: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		]);
		expect(userMessage?.content).not.toBe("Hello");
	});

	it("does not apply anthropic prompt-cache shaping for non-remapped providers", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "deepseek",
					apiKey: "deepseek-key",
					models: [
						{
							id: "deepseek-claude-alias",
							name: "DeepSeek Claude Alias",
							metadata: {
								family: "claude-sonnet",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "deepseek",
				modelId: "deepseek-claude-alias",
				messages: baseMessages,
				reasoning: {
					enabled: true,
					effort: "high",
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: "user", content: [{ type: "text", text: "Hello" }] },
				],
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.not.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					deepseek: expect.not.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					anthropic: expect.not.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		);
	});

	it("applies anthropic prompt-cache shaping for direct anthropic provider", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "anthropic-key",
					models: [
						{
							id: "claude-sonnet-4-6",
							name: "Claude Sonnet 4.6",
							metadata: {
								family: "claude-sonnet",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "text",
								text: "Hello",
								providerOptions: expect.objectContaining({
									anthropic: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
									openaiCompatible: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
								}),
							}),
						]),
					}),
				],
				providerOptions: expect.objectContaining({
					anthropic: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		);
	});

	it("does not apply anthropic prompt-cache shaping for remapped providers on non-claude families", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
					models: [
						{
							id: "router-gpt-alias",
							name: "Router GPT Alias",
							metadata: {
								family: "gpt",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "router-gpt-alias",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: "user", content: [{ type: "text", text: "Hello" }] },
				],
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.not.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					openrouter: expect.not.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		);
	});

	it("falls back to model-id detection for remapped providers when family metadata is absent", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-router-alias",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "text",
								providerOptions: expect.objectContaining({
									openrouter: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
								}),
							}),
						]),
					}),
				]),
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					openrouter: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		);
	});

	it("falls back to bedrock-style anthropic model ids when family metadata is absent", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "bedrock",
					apiKey: "bedrock-key",
					models: [
						{
							id: "anthropic.claude-sonnet-4-6",
							name: "Claude Sonnet 4.6 (Bedrock-style ID)",
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "bedrock",
				modelId: "anthropic.claude-sonnet-4-6",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "text",
								text: "Hello",
								providerOptions: expect.objectContaining({
									anthropic: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
									bedrock: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
								}),
							}),
						]),
					}),
				],
				providerOptions: expect.objectContaining({
					anthropic: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					bedrock: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		);
	});

	it("supports provider config metadata overrides for anthropic prompt-cache strategy", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "deepseek",
					apiKey: "deepseek-key",
					metadata: { promptCacheStrategy: "anthropic-automatic" },
					models: [
						{
							id: "deepseek-claude-alias",
							name: "DeepSeek Claude Alias",
							metadata: {
								family: "claude-sonnet",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "deepseek",
				modelId: "deepseek-claude-alias",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						role: "user",
						content: expect.arrayContaining([
							expect.objectContaining({
								type: "text",
								text: "Hello",
								providerOptions: expect.objectContaining({
									anthropic: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
									deepseek: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
								}),
							}),
						]),
					}),
				],
				providerOptions: expect.objectContaining({
					anthropic: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					deepseek: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		);
	});

	it("does not rewrite non-anthropic messages with prompt cache provider options", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "gemini",
					apiKey: "google-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: "user", content: [{ type: "text", text: "Hello" }] },
				],
			}),
		);
	});

	it("passes reasoning summary through for non-anthropic openai-compatible reasoning models", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cline",
					apiKey: "cline-key",
					models: [
						{
							id: "openai/gpt-5.4",
							name: "GPT-5.4",
							metadata: {
								family: "gpt",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "openai/gpt-5.4",
				messages: baseMessages,
				reasoning: {
					effort: "high",
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.objectContaining({
						reasoningEffort: "high",
						reasoningSummary: "auto",
					}),
					cline: expect.objectContaining({
						reasoning: expect.objectContaining({
							enabled: true,
							effort: "high",
						}),
						reasoningEffort: "high",
						reasoningSummary: "auto",
					}),
				}),
			}),
		);
	});

	it("passes native Z.AI thinking enabled and disabled provider options for GLM", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "zai",
					apiKey: "zai-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "zai",
				modelId: "glm-4.7",
				messages: baseMessages,
				reasoning: {
					enabled: true,
				},
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "zai",
				modelId: "glm-4.7",
				messages: baseMessages,
				reasoning: {
					enabled: false,
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					zai: expect.objectContaining({
						thinking: { type: "enabled" },
					}),
				}),
			}),
		);
		expect(streamTextSpy).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					zai: expect.objectContaining({
						thinking: { type: "disabled" },
					}),
				}),
			}),
		);
	});

	it("does not apply Z.AI GLM thinking controls to non-GLM native Z.AI models", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "zai",
					apiKey: "zai-key",
					models: [
						{
							id: "zai-other-model",
							name: "Non GLM Model",
							metadata: {
								family: "other",
							},
						},
					],
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "zai",
				modelId: "zai-other-model",
				messages: baseMessages,
				reasoning: {
					enabled: true,
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					zai: expect.not.objectContaining({
						thinking: expect.anything(),
					}),
					openaiCompatible: expect.not.objectContaining({
						thinking: expect.anything(),
					}),
				}),
			}),
		);
	});

	it("passes routed GLM reasoning include/exclude provider options", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "openrouter-key",
				},
				{
					providerId: "cline",
					apiKey: "cline-key",
				},
				{
					providerId: "vercel-ai-gateway",
					apiKey: "vercel-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				messages: baseMessages,
				reasoning: {
					enabled: true,
				},
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "z-ai/glm-4.7",
				messages: baseMessages,
				reasoning: {
					enabled: false,
				},
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "z-ai/glm-4.7",
				messages: baseMessages,
				reasoning: {
					enabled: false,
				},
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "vercel-ai-gateway",
				modelId: "z-ai/glm-4.7",
				messages: baseMessages,
				reasoning: {
					enabled: false,
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.objectContaining({
						reasoning: { enabled: true },
					}),
					openrouter: expect.objectContaining({
						reasoning: { enabled: true },
					}),
				}),
			}),
		);
		expect(streamTextSpy).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					openrouter: expect.objectContaining({
						reasoning: { exclude: true },
					}),
				}),
			}),
		);
		expect(streamTextSpy).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.objectContaining({
						reasoning: { exclude: true },
					}),
					cline: expect.objectContaining({
						reasoning: { exclude: true },
					}),
				}),
			}),
		);
		expect(streamTextSpy).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.objectContaining({
						reasoning: { exclude: true },
					}),
					vercelAiGateway: expect.objectContaining({
						reasoning: { exclude: true },
					}),
					"vercel-ai-gateway": expect.objectContaining({
						reasoning: { exclude: true },
					}),
				}),
			}),
		);
	});

	it("maps legacy model thinking options into gateway reasoning", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "zai",
					apiKey: "zai-key",
				},
			],
		});
		const model = gateway.createAgentModel({
			providerId: "zai",
			modelId: "glm-4.7",
		});

		await collect(
			await model.stream({
				messages: baseMessages,
				tools: [],
				options: {
					thinking: false,
				},
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					zai: expect.objectContaining({
						thinking: { type: "disabled" },
					}),
				}),
			}),
		);
	});

	it("adapts Anthropic and Gemini providers", async () => {
		streamTextSpy
			.mockReturnValueOnce({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: "Anthropic" },
					{ type: "finish", usage: { inputTokens: 5, outputTokens: 1 } },
				]),
			})
			.mockReturnValueOnce({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: "Gemini" },
					{ type: "finish", usage: { inputTokens: 6, outputTokens: 2 } },
				]),
			});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "anthropic", apiKey: "anthropic-key" },
				{ providerId: "gemini", apiKey: "google-key" },
			],
		});

		const anthropicEvents = await collect(
			await gateway.stream({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5",
				messages: baseMessages,
			}),
		);
		const geminiEvents = await collect(
			await gateway.stream({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				messages: baseMessages,
			}),
		);

		expect(anthropicSpy).toHaveBeenCalledWith("claude-sonnet-4-5");
		expect(googleSpy).toHaveBeenCalledWith("gemini-2.5-flash");
		expect(anthropicEvents[0]).toEqual({
			type: "text-delta",
			text: "Anthropic",
		});
		expect(geminiEvents[0]).toEqual({ type: "text-delta", text: "Gemini" });
	});

	it("normalizes models.dev catalogs into ModelInfo", () => {
		const result = normalizeModelsDevProviderModels({
			openai: {
				models: {
					"gpt-5": {
						name: "GPT-5",
						tool_call: true,
						reasoning: true,
						structured_output: true,
						release_date: "2026-01-01",
						limit: { context: 200000, output: 32000 },
						cost: { input: 1, output: 2 },
						modalities: { input: ["text", "image"] },
					},
				},
			},
		});

		expect(result["openai-native"]["gpt-5"]).toMatchObject({
			id: "gpt-5",
			name: "GPT-5",
			contextWindow: 200000,
			maxInputTokens: 200000,
			maxTokens: 32000,
			capabilities: expect.arrayContaining([
				"tools",
				"reasoning",
				"structured_output",
				"images",
			]),
			pricing: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
			releaseDate: "2026-01-01",
		});
	});

	it("uses provider apiKeyEnv fallback when no api key is configured", async () => {
		process.env.OPENROUTER_API_KEY = "env-openrouter-key";
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "text-delta", textDelta: "OpenRouter" },
				{ type: "finish", usage: { inputTokens: 3, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway();

		const events = await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-4.6",
				messages: baseMessages,
			}),
		);

		expect(openaiCompatibleSpy).toHaveBeenCalledWith(
			"anthropic/claude-sonnet-4.6",
		);
		expect(openaiCompatibleFactorySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "env-openrouter-key",
				baseURL: "https://openrouter.ai/api/v1",
				name: "openrouter",
			}),
		);
		expect(events[0]).toEqual({
			type: "text-delta",
			text: "OpenRouter",
		});
	});

	it("allows unregistered model ids on known providers", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "text-delta", textDelta: "Cline custom model" },
				{ type: "finish", usage: { inputTokens: 4, outputTokens: 2 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "cline", apiKey: "test-key" }],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "cline",
				modelId: "google/gemma-4-31b-it",
				messages: baseMessages,
			}),
		);

		expect(openaiCompatibleSpy).toHaveBeenCalledWith("google/gemma-4-31b-it");
		expect(events[0]).toEqual({
			type: "text-delta",
			text: "Cline custom model",
		});
	});

	it("forwards a per-provider fetch through to the provider config", async () => {
		const customFetch = vi.fn() as unknown as typeof fetch;
		const createProvider = vi.fn((config: { fetch?: typeof fetch }) => ({
			async *stream() {
				expect(config.fetch).toBe(customFetch);
				yield { type: "text-delta", text: "ok" } satisfies AgentModelEvent;
				yield { type: "finish", reason: "stop" } satisfies AgentModelEvent;
			},
		}));

		const gateway = createGateway({
			builtins: false,
			providers: [
				{
					manifest: {
						id: "custom-fetch",
						name: "CustomFetch",
						defaultModelId: "alpha",
						models: [
							{ id: "alpha", name: "Alpha", providerId: "custom-fetch" },
						],
					},
					createProvider,
				},
			],
			providerConfigs: [{ providerId: "custom-fetch", fetch: customFetch }],
		});

		await collect(
			await gateway.stream({
				providerId: "custom-fetch",
				modelId: "alpha",
				messages: baseMessages,
			}),
		);

		expect(createProvider).toHaveBeenCalledOnce();
	});

	it("falls back to the top-level gateway fetch when no provider fetch is set", async () => {
		const fallbackFetch = vi.fn() as unknown as typeof fetch;
		const createProvider = vi.fn((config: { fetch?: typeof fetch }) => ({
			async *stream() {
				expect(config.fetch).toBe(fallbackFetch);
				yield { type: "text-delta", text: "ok" } satisfies AgentModelEvent;
				yield { type: "finish", reason: "stop" } satisfies AgentModelEvent;
			},
		}));

		const gateway = createGateway({
			builtins: false,
			fetch: fallbackFetch,
			providers: [
				{
					manifest: {
						id: "custom-fetch-fallback",
						name: "CustomFetchFallback",
						defaultModelId: "alpha",
						models: [
							{
								id: "alpha",
								name: "Alpha",
								providerId: "custom-fetch-fallback",
							},
						],
					},
					createProvider,
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "custom-fetch-fallback",
				modelId: "alpha",
				messages: baseMessages,
			}),
		);

		expect(createProvider).toHaveBeenCalledOnce();
	});
});
