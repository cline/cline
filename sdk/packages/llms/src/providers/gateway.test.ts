import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentMessage,
	type AgentModelEvent,
	estimateRequestInputTokens,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeModelsDevProviderModels } from "../catalog/catalog-live";
import {
	createGateway,
	DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS,
	resolveGatewayRequestMaxTokens,
} from "./gateway";

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

function createFetchMock() {
	const fetchMock = vi.fn(
		async (
			_input: Parameters<typeof fetch>[0],
			_init?: Parameters<typeof fetch>[1],
		) => new Response("ok"),
	);
	return {
		fetchMock,
		fetch: fetchMock as unknown as typeof fetch,
	};
}

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
const originalCaptureProviderRequest =
	process.env.CLINE_CAPTURE_PROVIDER_REQUEST;
const originalCaptureWire = process.env.CLINE_CAPTURE_WIRE;
const originalCaptureDir = process.env.CLINE_CAPTURE_DIR;
const originalCaptureDataDir = process.env.CLINE_DATA_DIR;
const originalCaptureMaxPreviewBytes =
	process.env.CLINE_CAPTURE_MAX_PREVIEW_BYTES;
const originalCaptureCleanup = process.env.CLINE_CAPTURE_CLEANUP;

function readCaptureRecords(dir: string): Array<Record<string, unknown>> {
	return readdirSync(dir)
		.filter((file) => file.endsWith(".provider-request.json"))
		.sort()
		.map(
			(file) =>
				JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<
					string,
					unknown
				>,
		);
}

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
		if (originalCaptureProviderRequest === undefined) {
			delete process.env.CLINE_CAPTURE_PROVIDER_REQUEST;
		} else {
			process.env.CLINE_CAPTURE_PROVIDER_REQUEST =
				originalCaptureProviderRequest;
		}
		if (originalCaptureWire === undefined) {
			delete process.env.CLINE_CAPTURE_WIRE;
		} else {
			process.env.CLINE_CAPTURE_WIRE = originalCaptureWire;
		}
		if (originalCaptureDir === undefined) {
			delete process.env.CLINE_CAPTURE_DIR;
		} else {
			process.env.CLINE_CAPTURE_DIR = originalCaptureDir;
		}
		if (originalCaptureDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = originalCaptureDataDir;
		}
		if (originalCaptureMaxPreviewBytes === undefined) {
			delete process.env.CLINE_CAPTURE_MAX_PREVIEW_BYTES;
		} else {
			process.env.CLINE_CAPTURE_MAX_PREVIEW_BYTES =
				originalCaptureMaxPreviewBytes;
		}
		if (originalCaptureCleanup === undefined) {
			delete process.env.CLINE_CAPTURE_CLEANUP;
		} else {
			process.env.CLINE_CAPTURE_CLEANUP = originalCaptureCleanup;
		}
	});

	it("uses the old default output cap when request max tokens are omitted", () => {
		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: undefined,
				model: { maxOutputTokens: 202_800, contextWindow: 202_800 },
				estimatedInputTokens: 1_000,
			}),
		).toBe(DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS);
	});

	it("lifts the default output cap above an explicit reasoning budget", () => {
		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: undefined,
				reasoningBudgetTokens: 50_000,
				model: { maxOutputTokens: 202_800, contextWindow: 202_800 },
				estimatedInputTokens: 1_000,
				outputReserveTokens: 1_024,
			}),
		).toBe(51_024);

		// Still clamped by the model's max output tokens.
		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: undefined,
				reasoningBudgetTokens: 50_000,
				model: { maxOutputTokens: 40_000, contextWindow: 202_800 },
				estimatedInputTokens: 1_000,
			}),
		).toBe(40_000);

		// Explicit request max tokens still win over the reasoning floor.
		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: 8_192,
				reasoningBudgetTokens: 50_000,
				model: { maxOutputTokens: 202_800, contextWindow: 202_800 },
				estimatedInputTokens: 1_000,
			}),
		).toBe(8_192);
	});

	it("resolves explicit request max tokens from model and context caps", () => {
		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: 8_192,
				model: { maxOutputTokens: 202_800, contextWindow: 202_800 },
				estimatedInputTokens: 1_000,
			}),
		).toBe(8_192);

		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: 202_800,
				model: { maxOutputTokens: 202_800, contextWindow: 202_800 },
				estimatedInputTokens: 201_500,
				outputReserveTokens: 1_024,
			}),
		).toBe(276);

		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: undefined,
				model: {},
				estimatedInputTokens: 1_000,
			}),
		).toBeUndefined();
	});

	it("does not collapse to one output token when estimated input exceeds context", () => {
		const onContextOverflow = vi.fn();

		expect(
			resolveGatewayRequestMaxTokens({
				requestedMaxTokens: 8_192,
				model: { maxOutputTokens: 202_800, contextWindow: 10_000 },
				estimatedInputTokens: 9_500,
				outputReserveTokens: 1_024,
				onContextOverflow,
			}),
		).toBeUndefined();
		expect(onContextOverflow).toHaveBeenCalledWith({
			contextWindow: 10_000,
			estimatedInputTokens: 9_500,
			reserveTokens: 1_024,
		});
	});

	it("keeps estimating when request tools cannot be JSON stringified", () => {
		const circularTool = {
			name: "large_tool",
			description: "x".repeat(12_000),
		} as Record<string, unknown>;
		circularTool.self = circularTool;

		const estimatedTokens = estimateRequestInputTokens({
			systemPrompt: "system",
			messages: baseMessages,
			tools: [circularTool] as never,
		});

		expect(estimatedTokens).toBeGreaterThan(4_000);
	});

	it("applies the old default output cap when the request omits max tokens", async () => {
		const createProvider = vi.fn(() => ({
			async *stream(request: { maxTokens?: number }) {
				expect(request.maxTokens).toBe(DEFAULT_GATEWAY_MAX_OUTPUT_TOKENS);
				yield { type: "finish", reason: "stop" } satisfies AgentModelEvent;
			},
		}));

		const gateway = createGateway({
			builtins: false,
			providers: [
				{
					manifest: {
						id: "custom-provider",
						name: "CustomProvider",
						defaultModelId: "large-output",
						models: [
							{
								id: "large-output",
								name: "Large Output",
								providerId: "custom-provider",
								contextWindow: 202_800,
								maxInputTokens: 202_800,
								maxOutputTokens: 202_800,
							},
						],
					},
					createProvider,
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "custom-provider",
				modelId: "large-output",
				messages: baseMessages,
			}),
		);
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

		expect(providerIds).toContain("openai-compatible");
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
			routing: {
				promptCache: {
					format: "anthropic-cache-control",
				},
				reasoning: {
					format: "anthropic-thinking",
					routes: [
						{
							matcher: "anthropic-compatible",
						},
					],
				},
			},
		});
	});

	it("keeps Anthropic cache-control routing on the expected provider set", () => {
		const gateway = createGateway();
		const strategyProviders = gateway
			.listProviders()
			.filter(
				(provider) =>
					provider.metadata?.routing?.promptCache?.format ===
					"anthropic-cache-control",
			)
			.map((provider) => provider.id)
			.sort();

		expect(strategyProviders).toEqual([
			"aihubmix",
			"anthropic",
			"bedrock",
			"cline",
			"cline-pass",
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

	it("routes Qwen cache controls by model family instead of exact model ids", () => {
		const gateway = createGateway();
		const openrouter = gateway
			.listProviders()
			.find((provider) => provider.id === "openrouter");
		expect(openrouter?.metadata?.stickySession).toEqual({
			transport: "json-body",
			field: "session_id",
			metadataKey: "sessionId",
		});
		const promptCacheRoutes =
			openrouter?.metadata?.routing?.promptCache?.routes ?? [];

		expect(promptCacheRoutes).toEqual([
			{ matcher: "anthropic-compatible" },
			{
				matcher: "model-family",
				family: "qwen",
				requiredCapability: "prompt-cache",
			},
		]);
		expect(promptCacheRoutes).not.toContainEqual(
			expect.objectContaining({ matcher: "model-id" }),
		);

		const openrouterQwen = gateway
			.listModels("openrouter")
			.find((model) => model.id === "qwen/qwen3.6-plus");
		expect(openrouterQwen?.metadata?.family).toBe("qwen");
		expect(openrouterQwen?.capabilities).toContain("prompt-cache");

		const directQwen = gateway
			.listModels("qwen")
			.find((model) => model.id === "qwen-plus-latest");
		expect(directQwen).toBeDefined();
		expect(directQwen?.metadata?.family).toBe("qwen");
		expect(directQwen?.capabilities).toContain("prompt-cache");

		const directQwenCode = gateway
			.listModels("qwen-code")
			.find((model) => model.id === "qwen3-coder-plus");
		expect(directQwenCode).toBeDefined();
		expect(directQwenCode?.metadata?.family).toBe("qwen");
		expect(directQwenCode?.capabilities).toContain("prompt-cache");
	});

	it("deep-merges provider config routing metadata overrides", () => {
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					metadata: {
						routing: {
							promptCache: {
								format: "anthropic-cache-control",
								routes: [{ matcher: "model-id", modelId: "custom/qwen" }],
							},
						},
					},
				},
			],
		});

		const openrouter = gateway
			.listProviders()
			.find((provider) => provider.id === "openrouter");

		expect(openrouter?.metadata?.routing).toMatchObject({
			promptCache: {
				format: "anthropic-cache-control",
				routes: [{ matcher: "model-id", modelId: "custom/qwen" }],
			},
			reasoning: {
				format: "anthropic-thinking",
				routes: [{ matcher: "anthropic-compatible" }],
			},
		});
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
		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { maxOutputTokens?: unknown }
			| undefined;
		expect(call).not.toHaveProperty("maxOutputTokens");
	});

	it("sends explicit maxOutputTokens through the OpenAI Responses provider", async () => {
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
				messages: baseMessages,
				maxTokens: 8_192,
			}),
		);

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { maxOutputTokens?: unknown }
			| undefined;
		expect(call?.maxOutputTokens).toBe(8_192);
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

	it("strips reasoning history before sending Cerebras follow-up requests", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cerebras",
					apiKey: "cerebras-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "cerebras",
				modelId: "zai-glm-4.7",
				messages: [
					baseMessages[0],
					{
						id: "assistant_1",
						role: "assistant",
						content: [
							{ type: "reasoning", text: "internal thinking" },
							{ type: "text", text: "Hello!" },
						],
						createdAt: Date.now(),
					},
					{
						id: "user_2",
						role: "user",
						content: [{ type: "text", text: "tell me more" }],
						createdAt: Date.now(),
					},
				],
			}),
		);

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { messages?: unknown }
			| undefined;
		expect(call?.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "Hello!" }] },
			{ role: "user", content: [{ type: "text", text: "tell me more" }] },
		]);
		expect(JSON.stringify(call?.messages)).not.toContain("reasoning");
	});

	it("omits Cerebras reasoning-only assistant history instead of sending empty assistant content", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "cerebras",
					apiKey: "cerebras-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "cerebras",
				modelId: "zai-glm-4.7",
				messages: [
					baseMessages[0],
					{
						id: "assistant_1",
						role: "assistant",
						content: [{ type: "reasoning", text: "internal thinking" }],
						createdAt: Date.now(),
					},
					{
						id: "user_2",
						role: "user",
						content: [{ type: "text", text: "tell me more" }],
						createdAt: Date.now(),
					},
				],
			}),
		);

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { messages?: unknown }
			| undefined;
		expect(call?.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{ role: "user", content: [{ type: "text", text: "tell me more" }] },
		]);
		expect(JSON.stringify(call?.messages)).not.toContain("reasoning");
	});

	it("strips reasoning history for Cerebras base URL aliases", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "cerebras-key",
					baseUrl: "https://api.cerebras.ai",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-compatible",
				modelId: "zai-glm-4.7",
				messages: [
					baseMessages[0],
					{
						id: "assistant_1",
						role: "assistant",
						content: [
							{ type: "reasoning", text: "internal thinking" },
							{ type: "text", text: "Hello!" },
						],
						createdAt: Date.now(),
					},
					{
						id: "user_2",
						role: "user",
						content: [{ type: "text", text: "tell me more" }],
						createdAt: Date.now(),
					},
				],
			}),
		);

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { messages?: unknown }
			| undefined;
		expect(call?.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "Hello" }] },
			{ role: "assistant", content: [{ type: "text", text: "Hello!" }] },
			{ role: "user", content: [{ type: "text", text: "tell me more" }] },
		]);
		expect(JSON.stringify(call?.messages)).not.toContain("reasoning");
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

	it("adds OpenRouter BYOK account fee and upstream provider cost from nested raw usage", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 24559,
						completion_tokens: 31,
						raw: {
							cost: 0.000618625,
							is_byok: true,
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

	it("does not double-count OpenRouter credit-billed upstream cost from nested raw usage", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 15,
						completion_tokens: 5,
						raw: {
							cost: 0.0000301,
							is_byok: false,
							cost_details: {
								upstream_inference_cost: 0.0000301,
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
					defaultModelId: "z-ai/glm-5.1",
					models: [
						{
							id: "z-ai/glm-5.1",
							name: "GLM 5.1",
							metadata: {
								pricing: { input: 0.98, output: 3.08 },
							},
						},
					],
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "z-ai/glm-5.1",
				messages: baseMessages,
			}),
		);

		const usageEvent = events.find(
			(event): event is Extract<AgentModelEvent, { type: "usage" }> =>
				event.type === "usage",
		);
		expect(usageEvent?.usage.totalCost).toBe(0.0000301);
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

	it("preserves Vertex thought signatures on tool calls and replays them", async () => {
		streamTextSpy.mockReturnValueOnce({
			fullStream: makeStreamParts([
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "editor",
					input: { path: "/tmp/out.txt" },
					providerMetadata: {
						vertex: {
							thoughtSignature: "sig_1",
						},
					},
				},
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "vertex",
					options: {
						project: "test-project",
						location: "global",
					},
				},
			],
		});

		const events = await collect(
			await gateway.stream({
				providerId: "vertex",
				modelId: "gemini-3-flash-preview",
				messages: baseMessages,
				tools: [
					{
						name: "editor",
						description: "Edits files",
						inputSchema: { type: "object" },
					},
				],
			}),
		);

		expect(events).toContainEqual(
			expect.objectContaining({
				type: "tool-call-delta",
				toolCallId: "call_1",
				toolName: "editor",
				metadata: expect.objectContaining({
					thoughtSignature: "sig_1",
				}),
			}),
		);

		const toolCallEvent = events.find(
			(event): event is Extract<AgentModelEvent, { type: "tool-call-delta" }> =>
				event.type === "tool-call-delta",
		);
		expect(toolCallEvent).toBeDefined();

		streamTextSpy.mockReset();

		const replayCases = [
			{
				name: "fresh event metadata",
				metadata: toolCallEvent?.metadata,
			},
			{
				name: "persisted history metadata",
				metadata: { signature: "sig_1" },
			},
		];

		for (const replayCase of replayCases) {
			streamTextSpy.mockReset();
			streamTextSpy.mockReturnValueOnce({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: `done ${replayCase.name}` },
					{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
				]),
			});

			await collect(
				await gateway.stream({
					providerId: "vertex",
					modelId: "gemini-3-flash-preview",
					messages: [
						{
							id: `assistant_${replayCase.name}`,
							role: "assistant",
							content: [
								{
									type: "tool-call",
									toolCallId: "call_1",
									toolName: "editor",
									input: { path: "/tmp/out.txt" },
									metadata: replayCase.metadata,
								},
							],
							createdAt: Date.now(),
						},
						{
							id: `tool_${replayCase.name}`,
							role: "tool",
							content: [
								{
									type: "tool-result",
									toolCallId: "call_1",
									toolName: "editor",
									output: { ok: true },
								},
							],
							createdAt: Date.now(),
						},
					],
					tools: [
						{
							name: "editor",
							description: "Edits files",
							inputSchema: { type: "object" },
						},
					],
				}),
			);

			expect(streamTextSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: expect.arrayContaining([
						expect.objectContaining({
							role: "assistant",
							content: [
								expect.objectContaining({
									type: "tool-call",
									toolCallId: "call_1",
									toolName: "editor",
									providerOptions: {
										google: {
											thoughtSignature: "sig_1",
										},
									},
								}),
							],
						}),
					]),
				}),
			);
		}
	});

	it("preserves legacy Google snake_case thought signatures", async () => {
		streamTextSpy.mockReturnValueOnce({
			fullStream: makeStreamParts([
				{
					type: "tool-call",
					toolCallId: "call_legacy",
					toolName: "editor",
					input: { path: "/tmp/out.txt" },
					providerMetadata: {
						google: {
							thought_signature: "sig_legacy",
						},
					},
				},
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

		const events = await collect(
			await gateway.stream({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				messages: baseMessages,
				tools: [
					{
						name: "editor",
						description: "Edits files",
						inputSchema: { type: "object" },
					},
				],
			}),
		);

		expect(events).toContainEqual(
			expect.objectContaining({
				type: "tool-call-delta",
				toolCallId: "call_legacy",
				toolName: "editor",
				metadata: expect.objectContaining({
					thought_signature: "sig_legacy",
				}),
			}),
		);

		streamTextSpy.mockReset();
		streamTextSpy.mockReturnValueOnce({
			fullStream: makeStreamParts([
				{ type: "text-delta", textDelta: "done" },
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		await collect(
			await gateway.stream({
				providerId: "gemini",
				modelId: "gemini-2.5-flash",
				messages: [
					{
						id: "assistant_legacy",
						role: "assistant",
						content: [
							{
								type: "tool-call",
								toolCallId: "call_legacy",
								toolName: "editor",
								input: { path: "/tmp/out.txt" },
								metadata: {
									thought_signature: "sig_legacy",
								},
							},
						],
						createdAt: Date.now(),
					},
					{
						id: "tool_legacy",
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolCallId: "call_legacy",
								toolName: "editor",
								output: { ok: true },
							},
						],
						createdAt: Date.now(),
					},
				],
				tools: [
					{
						name: "editor",
						description: "Edits files",
						inputSchema: { type: "object" },
					},
				],
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "assistant",
						content: [
							expect.objectContaining({
								type: "tool-call",
								toolCallId: "call_legacy",
								toolName: "editor",
								providerOptions: {
									google: {
										thoughtSignature: "sig_legacy",
									},
								},
							}),
						],
					}),
				]),
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

	it("does not send maxOutputTokens to ChatGPT OAuth when the request omits max tokens", async () => {
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
			}),
		);

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { maxOutputTokens?: unknown }
			| undefined;
		expect(call).not.toHaveProperty("maxOutputTokens");
	});

	it("does not send explicit maxOutputTokens to ChatGPT OAuth", async () => {
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
				maxTokens: 8_192,
			}),
		);

		const call = streamTextSpy.mock.calls.at(-1)?.[0] as
			| { maxOutputTokens?: unknown }
			| undefined;
		expect(call).not.toHaveProperty("maxOutputTokens");
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
			| {
					maxOutputTokens?: unknown;
					providerOptions?: Record<string, Record<string, unknown>>;
			  }
			| undefined;
		expect(call).not.toHaveProperty("maxOutputTokens");
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
							capabilities: ["prompt-cache"],
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
			{ type: "text", text: " " },
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
					metadata: {
						routing: {
							promptCache: {
								format: "anthropic-cache-control",
								routes: [{ matcher: "anthropic-compatible" }],
							},
						},
					},
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

	it("preserves legacy promptCacheStrategy for custom Qwen provider configs", async () => {
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
					metadata: {
						promptCacheStrategy: "anthropic-automatic",
					},
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "deepseek",
				modelId: "qwen/qwen3.6-plus",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					expect.objectContaining({
						role: "user",
						content: [
							expect.objectContaining({
								type: "text",
								text: "Hello",
								providerOptions: expect.objectContaining({
									openaiCompatible: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
									deepseek: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
								}),
							}),
							{ type: "text", text: " " },
						],
					}),
				],
				providerOptions: expect.objectContaining({
					openaiCompatible: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
					deepseek: expect.objectContaining({
						cache_control: { type: "ephemeral" },
					}),
				}),
			}),
		);
		const qwenCall = streamTextSpy.mock.calls.at(-1)?.[0] as {
			providerOptions?: Record<string, Record<string, unknown> | undefined>;
		};
		expect(qwenCall.providerOptions?.anthropic).not.toEqual(
			expect.objectContaining({
				cache_control: { type: "ephemeral" },
			}),
		);
	});

	it("forwards Anthropic-style prompt cache controls for Qwen on OpenRouter", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					usage: {
						prompt_tokens: 10126,
						completion_tokens: 13,
						prompt_tokens_details: {
							cached_tokens: 0,
							cache_write_tokens: 10106,
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
				modelId: "qwen/qwen3.6-plus",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: "user",
						content: [
							expect.objectContaining({
								type: "text",
								providerOptions: expect.objectContaining({
									openaiCompatible: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
									openrouter: expect.objectContaining({
										cache_control: { type: "ephemeral" },
									}),
								}),
							}),
							{ type: "text", text: " " },
						],
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
		const qwenCall = streamTextSpy.mock.calls.at(-1)?.[0] as {
			providerOptions?: Record<string, Record<string, unknown> | undefined>;
		};
		expect(qwenCall.providerOptions?.anthropic).not.toEqual(
			expect.objectContaining({
				cache_control: { type: "ephemeral" },
			}),
		);
		expect(events).toContainEqual({
			type: "usage",
			usage: expect.objectContaining({
				cacheReadTokens: 0,
				cacheWriteTokens: 10106,
			}),
		});
	});

	it.each([
		{
			providerId: "cline",
			modelId: "qwen/qwen3.6-plus",
			providerOptionsKey: "cline",
			aliasKey: undefined,
		},
		{
			providerId: "vercel-ai-gateway",
			modelId: "alibaba/qwen3.6-plus",
			providerOptionsKey: "vercel-ai-gateway",
			aliasKey: "vercelAiGateway",
		},
	])("forwards Qwen prompt cache controls without Anthropic reasoning for $providerId", async ({
		providerId,
		modelId,
		providerOptionsKey,
		aliasKey,
	}) => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId,
					apiKey: "provider-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId,
				modelId,
				messages: baseMessages,
				reasoning: { enabled: true, effort: "high" },
			}),
		);

		const qwenCall = streamTextSpy.mock.calls.at(-1)?.[0] as {
			messages?: Array<{
				role: string;
				content: Array<{
					type: string;
					providerOptions?: Record<string, Record<string, unknown>>;
				}>;
			}>;
			providerOptions?: Record<string, Record<string, unknown> | undefined>;
		};
		const expectedCacheControl = {
			cache_control: { type: "ephemeral" },
		};

		expect(qwenCall.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					role: "user",
					content: [
						expect.objectContaining({
							type: "text",
							providerOptions: expect.objectContaining({
								openaiCompatible: expect.objectContaining(expectedCacheControl),
								[providerOptionsKey]:
									expect.objectContaining(expectedCacheControl),
							}),
						}),
						{ type: "text", text: " " },
					],
				}),
			]),
		);
		expect(qwenCall.providerOptions).toEqual(
			expect.objectContaining({
				openaiCompatible: expect.objectContaining(expectedCacheControl),
				[providerOptionsKey]: expect.objectContaining(expectedCacheControl),
			}),
		);
		if (aliasKey) {
			expect(qwenCall.providerOptions?.[aliasKey]).toEqual(
				expect.objectContaining(expectedCacheControl),
			);
		}
		expect(qwenCall.providerOptions?.[providerOptionsKey]).not.toEqual(
			expect.objectContaining({
				reasoning: expect.anything(),
			}),
		);
		expect(qwenCall.providerOptions?.anthropic).not.toEqual(
			expect.objectContaining(expectedCacheControl),
		);
	});

	it.each([
		{
			providerId: "openrouter",
			modelId: "qwen/qwen-future-cache-model",
		},
		{
			providerId: "vercel-ai-gateway",
			modelId: "alibaba/qwen-future-cache-model",
		},
	])("does not prompt-cache unregistered $providerId Qwen ids without capability metadata", async ({
		providerId,
		modelId,
	}) => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId, apiKey: "test-key" }],
		});

		await collect(
			await gateway.stream({
				providerId,
				modelId,
				messages: baseMessages,
			}),
		);

		expect(openaiCompatibleSpy).toHaveBeenCalledWith(modelId);
		const call = streamTextSpy.mock.calls.at(-1)?.[0];
		expect(JSON.stringify(call)).not.toContain("cache_control");
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

	it("passes Chutes Kimi K2.6 TEE reasoning controls through provider options", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "chutes", apiKey: "chutes-key" }],
		});

		await collect(
			await gateway.stream({
				providerId: "chutes",
				modelId: "moonshotai/Kimi-K2.6-TEE",
				messages: baseMessages,
				reasoning: { enabled: true, effort: "high" },
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "chutes",
				modelId: "moonshotai/Kimi-K2.6-TEE",
				messages: baseMessages,
				reasoning: { enabled: false, effort: "high" },
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "chutes",
				modelId: "moonshotai/Kimi-K2.6-TEE",
				messages: baseMessages,
			}),
		);

		expect(streamTextSpy).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					chutes: expect.objectContaining({
						chat_template_kwargs: {
							thinking: true,
							preserve_thinking: true,
						},
					}),
				}),
			}),
		);
		expect(streamTextSpy).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					chutes: expect.objectContaining({
						chat_template_kwargs: { thinking: false },
					}),
				}),
			}),
		);

		const defaultProviderOptions = (
			streamTextSpy.mock.calls[2]?.[0] as {
				providerOptions?: Record<string, Record<string, unknown>>;
			}
		).providerOptions;
		for (const bucket of ["chutes", "openaiCompatible"] as const) {
			expect(defaultProviderOptions?.[bucket]).not.toHaveProperty(
				"chat_template_kwargs",
			);
		}

		for (const call of streamTextSpy.mock.calls) {
			const providerOptions = (
				call[0] as {
					providerOptions?: Record<string, Record<string, unknown>>;
				}
			).providerOptions;
			for (const bucket of ["chutes", "openaiCompatible"] as const) {
				expect(providerOptions?.[bucket]).not.toHaveProperty("thinking");
				expect(providerOptions?.[bucket]).not.toHaveProperty("reasoningEffort");
				expect(providerOptions?.[bucket]).not.toHaveProperty("effort");
			}
		}
	});

	it("routes Chutes Kimi and Qwen reasoning controls by model family", async () => {
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{ type: "finish", usage: { inputTokens: 1, outputTokens: 1 } },
			]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "chutes", apiKey: "chutes-key" }],
		});

		await collect(
			await gateway.stream({
				providerId: "chutes",
				modelId: "moonshotai/Kimi-K2.5-TEE",
				messages: baseMessages,
				reasoning: { enabled: false },
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "chutes",
				modelId: "Qwen/Qwen3-32B-TEE",
				messages: baseMessages,
				reasoning: { enabled: true },
			}),
		);
		await collect(
			await gateway.stream({
				providerId: "chutes",
				modelId: "Qwen/Qwen3-235B-A22B-Thinking-2507-TEE",
				messages: baseMessages,
				reasoning: { enabled: false },
			}),
		);

		expect(streamTextSpy).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					chutes: expect.objectContaining({
						chat_template_kwargs: { thinking: false },
					}),
				}),
			}),
		);
		expect(streamTextSpy).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					chutes: expect.objectContaining({
						chat_template_kwargs: { enable_thinking: true },
					}),
				}),
			}),
		);

		const thinkingOnlyProviderOptions = (
			streamTextSpy.mock.calls[2]?.[0] as {
				providerOptions?: Record<string, Record<string, unknown>>;
			}
		).providerOptions;
		expect(thinkingOnlyProviderOptions?.chutes).not.toHaveProperty(
			"chat_template_kwargs",
		);
	});

	it("does not apply generic thinking to non-GLM native Z.AI custom models", async () => {
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
						reasoning: { enabled: true, max_tokens: 19_200 },
					}),
				}),
			}),
		);
		expect(streamTextSpy).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				providerOptions: expect.objectContaining({
					openrouter: expect.objectContaining({
						reasoning: { effort: "none" },
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

	it("writes AI SDK prompt captures with request metadata correlation", async () => {
		const captureDir = mkdtempSync(join(tmpdir(), "llms-capture-"));
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary";
		process.env.CLINE_CAPTURE_DIR = captureDir;
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([
				{
					type: "finish",
					finishReason: "stop",
					usage: { inputTokens: 1, outputTokens: 1 },
				},
			]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "test-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: {
					captureId: "cap-session-1-run-1-2",
					sessionId: "session-1",
					runId: "run-1",
					conversationId: "conv-1",
					iteration: 2,
				},
			}),
		);

		const records = readCaptureRecords(captureDir);
		expect(records).toHaveLength(1);
		expect(readdirSync(captureDir)).toContain(
			"cap-session-1-run-1-2.ai_sdk_prompt.1.provider-request.json",
		);
		expect(records[0]).toMatchObject({
			captureStage: "ai_sdk_prompt",
			attempt: 1,
			mode: "summary",
			correlation: {
				captureId: "cap-session-1-run-1-2",
				sessionId: "session-1",
				runId: "run-1",
				conversationId: "conv-1",
				iteration: 2,
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
			},
		});
		expect(records[0]?.summary).toMatchObject({
			messages: {
				messageCount: 1,
				roleCounts: { user: 1 },
				messages: [
					expect.objectContaining({
						index: 0,
						role: "user",
						sha256: expect.any(String),
					}),
				],
			},
		});
		expect(records[0]).not.toHaveProperty("payload");
	});

	it("falls back to a stable per-request capture filename without captureId", async () => {
		const captureDir = mkdtempSync(join(tmpdir(), "llms-capture-fallback-"));
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary";
		process.env.CLINE_CAPTURE_DIR = captureDir;
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "openrouter", apiKey: "test-key" }],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { runId: "run-fallback", iteration: 4 },
			}),
		);

		const files = readdirSync(captureDir).filter((file) =>
			file.endsWith(".provider-request.json"),
		);
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(
			/^cap_run-fallback_4_[a-f0-9]{16}\.ai_sdk_prompt\.1\.provider-request\.json$/,
		);
	});

	it("honors the full capture preview byte cap override", async () => {
		const captureDir = mkdtempSync(join(tmpdir(), "llms-full-capture-"));
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "full";
		process.env.CLINE_CAPTURE_DIR = captureDir;
		process.env.CLINE_CAPTURE_MAX_PREVIEW_BYTES = "24";
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openrouter",
					apiKey: "test-key",
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: [
					{
						id: "user_full",
						role: "user",
						content: [{ type: "text", text: "Hello ".repeat(50) }],
						createdAt: Date.now(),
					},
				],
			}),
		);

		const payload = readCaptureRecords(captureDir)[0]?.payload as
			| { preview?: string; truncated?: boolean }
			| undefined;
		expect(payload).toMatchObject({ truncated: true });
		expect(
			Buffer.byteLength(payload?.preview ?? "", "utf8"),
		).toBeLessThanOrEqual(24);
	});

	it("does not write provider request captures without an explicit capture or data dir", async () => {
		const cwd = process.cwd();
		const tempCwd = mkdtempSync(join(tmpdir(), "llms-capture-cwd-"));
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary";
		delete process.env.CLINE_CAPTURE_DIR;
		delete process.env.CLINE_DATA_DIR;
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		try {
			process.chdir(tempCwd);
			const gateway = createGateway({
				providerConfigs: [
					{
						providerId: "openrouter",
						apiKey: "test-key",
					},
				],
			});

			await collect(
				await gateway.stream({
					providerId: "openrouter",
					modelId: "anthropic/claude-test",
					messages: baseMessages,
				}),
			);

			await expect(
				access(join(tempCwd, ".cline", "provider-request-captures")),
			).rejects.toThrow();
		} finally {
			process.chdir(cwd);
		}
	});

	it("does not wrap provider fetch when wire capture is disabled", async () => {
		const customFetch = vi.fn() as unknown as typeof fetch;
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(config.fetch).toBe(customFetch);
	});

	it("adds OpenRouter session_id to JSON wire requests from request metadata", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: {
					sessionId: "session-openrouter",
					conversationId: "conversation-openrouter",
				},
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(config.fetch).not.toBe(customFetch);
		await config.fetch?.("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(customFetch).toHaveBeenCalledOnce();
		const init = customFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(JSON.parse(String(init?.body))).toMatchObject({
			session_id: "session-openrouter",
		});
	});

	it("preserves default model metadata when request metadata is present", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});
		const model = gateway.createAgentModel(
			{
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
			},
			{
				metadata: {
					sessionId: "default-session",
					traceId: "default-trace",
				},
			},
		);

		await collect(
			await model.stream({
				messages: baseMessages,
				tools: [],
				options: {
					metadata: {
						runId: "request-run",
						traceId: "request-trace",
					},
				},
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(config.fetch).not.toBe(customFetch);
		await config.fetch?.("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(customFetch).toHaveBeenCalledOnce();
		const init = customFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(JSON.parse(String(init?.body))).toMatchObject({
			session_id: "default-session",
		});
	});

	it("adds configured JSON-body sticky session fields for providers that opt in", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					fetch: customFetch,
					metadata: {
						stickySession: {
							transport: "json-body",
							field: "sticky_session",
							metadataKey: "sessionId",
						},
					},
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-compatible",
				modelId: "custom/model",
				messages: baseMessages,
				metadata: { sessionId: "session-longer-than-eight" },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(config.fetch).not.toBe(customFetch);
		await config.fetch?.("https://example.test/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(customFetch).toHaveBeenCalledOnce();
		const init = customFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(JSON.parse(String(init?.body))).toMatchObject({
			sticky_session: "session-longer-than-eight",
		});
	});

	it("adds configured header sticky session fields for providers that opt in", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					fetch: customFetch,
					metadata: {
						stickySession: {
							transport: "header",
							field: "x-session-id",
							metadataKey: "sessionId",
						},
					},
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-compatible",
				modelId: "custom/model",
				messages: baseMessages,
				metadata: { sessionId: "session-header" },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(config.fetch).not.toBe(customFetch);
		await config.fetch?.("https://example.test/v1/chat/completions", {
			method: "POST",
			headers: { "x-existing": "kept" },
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(customFetch).toHaveBeenCalledOnce();
		const init = customFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		const headers = new Headers(init?.headers);
		expect(headers.get("x-session-id")).toBe("session-header");
		expect(headers.get("x-existing")).toBe("kept");
	});

	it("preserves explicit configured header sticky session values", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					fetch: customFetch,
					metadata: {
						stickySession: {
							transport: "header",
							field: "x-session-id",
							metadataKey: "sessionId",
						},
					},
				},
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openai-compatible",
				modelId: "custom/model",
				messages: baseMessages,
				metadata: { sessionId: "session-header" },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		await config.fetch?.("https://example.test/v1/chat/completions", {
			method: "POST",
			headers: { "x-session-id": "explicit-header-session" },
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		const init = customFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(new Headers(init?.headers).get("x-session-id")).toBe(
			"explicit-header-session",
		);
	});

	it("preserves explicit OpenRouter session_id in JSON wire requests", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { sessionId: "session-openrouter" },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		await config.fetch?.("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({
				session_id: "explicit-session",
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		const init = customFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(JSON.parse(String(init?.body))).toMatchObject({
			session_id: "explicit-session",
		});
	});

	it("does not inspect a Request body when init explicitly sets a null body", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { sessionId: "session-openrouter" },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		const request = new Request(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				method: "POST",
				body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
			},
		);
		await config.fetch?.(request, { body: null });

		expect(customFetch).toHaveBeenCalledOnce();
		expect(customFetchMock.mock.calls[0]?.[0]).toBe(request);
		const init = customFetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(init?.body).toBeNull();
	});

	it("does not fall back to conversationId for OpenRouter session_id", async () => {
		const { fetchMock: customFetchMock, fetch: customFetch } =
			createFetchMock();
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { conversationId: "conversation-openrouter" },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(config.fetch).toBe(customFetch);
	});

	it("wraps provider fetch for wire capture while delegating to the configured fetch", async () => {
		const captureDir = mkdtempSync(join(tmpdir(), "llms-wire-capture-"));
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary";
		process.env.CLINE_CAPTURE_WIRE = "true";
		process.env.CLINE_CAPTURE_DIR = captureDir;
		const customFetch = vi.fn(
			async () => new Response("ok"),
		) as unknown as typeof fetch;
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { runId: "run-wire", iteration: 3 },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		expect(config.fetch).not.toBe(customFetch);
		await config.fetch?.("https://example.test/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});

		expect(customFetch).toHaveBeenCalledOnce();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const records = readCaptureRecords(captureDir);
		expect(records.map((record) => record.captureStage)).toEqual([
			"ai_sdk_prompt",
			"wire_request",
		]);
		expect(records[1]).toMatchObject({
			captureStage: "wire_request",
			correlation: {
				runId: "run-wire",
				iteration: 3,
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
			},
			summary: {
				messages: {
					messageCount: 1,
					roleCounts: { user: 1 },
					messages: [
						expect.objectContaining({
							index: 0,
							role: "user",
							sha256: expect.any(String),
						}),
					],
				},
			},
		});
	});

	it("increments capture attempts instead of overwriting repeated wire requests", async () => {
		const captureDir = mkdtempSync(join(tmpdir(), "llms-wire-attempts-"));
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary";
		process.env.CLINE_CAPTURE_WIRE = "true";
		process.env.CLINE_CAPTURE_DIR = captureDir;
		const customFetch = vi.fn(
			async () => new Response("ok"),
		) as unknown as typeof fetch;
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [
				{ providerId: "openrouter", apiKey: "test-key", fetch: customFetch },
			],
		});

		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { captureId: "cap-repeat", runId: "run-repeat" },
			}),
		);

		const config = openaiCompatibleFactorySpy.mock.calls[0]?.[0] as {
			fetch?: typeof fetch;
		};
		await config.fetch?.("https://example.test/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "first" }] }),
		});
		await config.fetch?.("https://example.test/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "second" }] }),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(
			readdirSync(captureDir)
				.filter((file) => file.endsWith(".provider-request.json"))
				.sort(),
		).toEqual([
			"cap-repeat.ai_sdk_prompt.1.provider-request.json",
			"cap-repeat.wire_request.1.provider-request.json",
			"cap-repeat.wire_request.2.provider-request.json",
		]);
		const records = readCaptureRecords(captureDir);
		expect(records.map((record) => record.attempt)).toEqual([1, 1, 2]);
	});

	it("prunes old capture files unless cleanup is disabled", async () => {
		const captureDir = mkdtempSync(join(tmpdir(), "llms-capture-cleanup-"));
		const oldFile = join(
			captureDir,
			"old.ai_sdk_prompt.1.provider-request.json",
		);
		writeFileSync(oldFile, "{}\n", { mode: 0o600 });
		const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
		utimesSync(oldFile, oldDate, oldDate);
		process.env.CLINE_CAPTURE_PROVIDER_REQUEST = "summary";
		process.env.CLINE_CAPTURE_DIR = captureDir;
		streamTextSpy.mockReturnValue({
			fullStream: makeStreamParts([{ type: "finish", finishReason: "stop" }]),
		});

		const gateway = createGateway({
			providerConfigs: [{ providerId: "openrouter", apiKey: "test-key" }],
		});
		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { captureId: "cap-cleanup-on" },
			}),
		);

		expect(readdirSync(captureDir)).not.toContain(
			"old.ai_sdk_prompt.1.provider-request.json",
		);

		const keepDir = mkdtempSync(join(tmpdir(), "llms-capture-keep-"));
		const keepFile = join(keepDir, "old.ai_sdk_prompt.1.provider-request.json");
		writeFileSync(keepFile, "{}\n", { mode: 0o600 });
		utimesSync(keepFile, oldDate, oldDate);
		process.env.CLINE_CAPTURE_DIR = keepDir;
		process.env.CLINE_CAPTURE_CLEANUP = "off";
		await collect(
			await gateway.stream({
				providerId: "openrouter",
				modelId: "anthropic/claude-test",
				messages: baseMessages,
				metadata: { captureId: "cap-cleanup-off" },
			}),
		);

		expect(readdirSync(keepDir)).toContain(
			"old.ai_sdk_prompt.1.provider-request.json",
		);
	});
});
