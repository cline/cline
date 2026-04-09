import type { AgentMessage, AgentModelEvent } from "@clinebot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeModelsDevProviderModels } from "../model/catalog-live";
import { createGateway } from "./index";

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

vi.mock("ai", () => ({
	streamText: (input: unknown) => streamTextSpy(input),
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

async function* makeStreamParts(parts: unknown[]) {
	for (const part of parts) {
		yield part;
	}
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
		expect(providerIds).toContain("claude-code");
		expect(providerIds).toContain("openai-codex");
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
			metadata: undefined,
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
						thinking: { type: "adaptive" },
						effort: "high",
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

	it("detects anthropic-compatible models by family and forwards reasoning plus prompt cache", async () => {
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
						reasoning: expect.objectContaining({
							enabled: true,
							max_tokens: expect.any(Number),
						}),
					}),
					openrouter: expect.objectContaining({
						reasoning: expect.objectContaining({
							enabled: true,
							max_tokens: expect.any(Number),
						}),
						reasoningEffort: "high",
						thinking: { type: "adaptive" },
					}),
					anthropic: expect.objectContaining({
						thinking: { type: "adaptive" },
						effort: "high",
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
		const result = normalizeModelsDevProviderModels(
			{
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
			},
			{ openai: "openai" },
		);

		expect(result.openai["gpt-5"]).toMatchObject({
			id: "gpt-5",
			name: "GPT-5",
			contextWindow: 200000,
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
});
