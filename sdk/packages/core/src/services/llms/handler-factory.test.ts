import type { AgentConfig, AgentModel, ITelemetryService } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMock = vi.hoisted(() => {
	const createAgentModel = vi.fn();
	const generatedModelsByProvider: Record<string, Record<string, unknown>> = {};
	const curatedCollectionsByProvider: Record<
		string,
		{ models: Record<string, unknown> }
	> = {};
	return {
		createAgentModel,
		generatedModelsByProvider,
		curatedCollectionsByProvider,
		createGateway: vi.fn(() => ({ createAgentModel })),
		// Registry helpers used by createAgentModelFromConfig. Default to "no
		// registered handler" so existing tests exercise the gateway path.
		hasRegisteredHandler: vi.fn(() => false),
		createHandlerAsync: vi.fn(),
	};
});

vi.mock("@cline/llms", () => ({
	createGateway: gatewayMock.createGateway,
	MODEL_COLLECTIONS_BY_PROVIDER_ID: gatewayMock.curatedCollectionsByProvider,
	hasRegisteredHandler: gatewayMock.hasRegisteredHandler,
	createHandlerAsync: gatewayMock.createHandlerAsync,
	normalizeProviderId: (id: string) => id,
	resolveProviderModelCatalogKeys: (id: string) => [id],
	getGeneratedModelsForProvider: (id: string) =>
		gatewayMock.generatedModelsByProvider[id] ?? {},
}));

describe("createAgentModelFromConfig", () => {
	beforeEach(() => {
		gatewayMock.createAgentModel.mockReset();
		gatewayMock.createGateway.mockClear();
		gatewayMock.createGateway.mockImplementation(() => ({
			createAgentModel: gatewayMock.createAgentModel,
		}));
		gatewayMock.hasRegisteredHandler.mockReset();
		gatewayMock.hasRegisteredHandler.mockReturnValue(false);
		gatewayMock.createHandlerAsync.mockReset();
		for (const providerId of Object.keys(
			gatewayMock.generatedModelsByProvider,
		)) {
			delete gatewayMock.generatedModelsByProvider[providerId];
		}
		for (const providerId of Object.keys(
			gatewayMock.curatedCollectionsByProvider,
		)) {
			delete gatewayMock.curatedCollectionsByProvider[providerId];
		}
	});

	it("uses generated catalog metadata when the host does not pass knownModels", async () => {
		gatewayMock.generatedModelsByProvider.gemini = {
			"veo-test": {
				id: "veo-test",
				name: "Veo Test",
				modalities: { input: ["text"], output: ["video"] },
				capabilities: [],
			},
		};
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "gemini",
				modelId: "veo-test",
				apiKey: "key",
				systemPrompt: "",
				tools: [],
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						models: [
							expect.objectContaining({
								id: "veo-test",
								modalities: { input: ["text"], output: ["video"] },
							}),
						],
					}),
				],
			}),
		);
	});

	it("preserves curated models and only supplements missing generated media models", async () => {
		gatewayMock.curatedCollectionsByProvider["openai-codex"] = {
			models: {
				"gpt-5.5": {
					id: "gpt-5.5",
					name: "Curated GPT-5.5",
					maxInputTokens: 258_400,
				},
				"curated-video-model": {
					id: "curated-video-model",
					name: "Curated Video Model",
					maxInputTokens: 8_192,
					modalities: { input: ["text"], output: ["video"] },
				},
			},
		};
		gatewayMock.generatedModelsByProvider["openai-codex"] = {
			"gpt-5.5": {
				id: "gpt-5.5",
				name: "Unfiltered GPT-5.5",
				maxInputTokens: 400_000,
			},
			"unsupported-chat-model": {
				id: "unsupported-chat-model",
				modalities: { input: ["text"], output: ["text"] },
			},
			"curated-video-model": {
				id: "curated-video-model",
				name: "Generated Video Model",
				maxInputTokens: 128_000,
				modalities: { input: ["text"], output: ["video"] },
			},
			"generated-image-model": {
				id: "generated-image-model",
				modalities: { input: ["text"], output: ["image"] },
			},
			"generated-video-model": {
				id: "generated-video-model",
				modalities: { input: ["text"], output: ["video"] },
			},
			"mixed-video-model": {
				id: "mixed-video-model",
				modalities: { input: ["text"], output: ["text", "video"] },
			},
			"generated-audio-model": {
				id: "generated-audio-model",
				modalities: { input: ["text"], output: ["audio"] },
			},
		};
		const { resolveKnownModelsFromConfig } = await import("./handler-factory");

		const models = resolveKnownModelsFromConfig({
			providerId: "openai-codex",
			modelId: "gpt-5.5",
			systemPrompt: "",
			tools: [],
		});

		expect(models?.["gpt-5.5"]).toMatchObject({
			name: "Curated GPT-5.5",
			maxInputTokens: 258_400,
		});
		expect(models?.["curated-video-model"]).toMatchObject({
			name: "Curated Video Model",
			maxInputTokens: 8_192,
		});
		expect(models).not.toHaveProperty("unsupported-chat-model");
		expect(models).not.toHaveProperty("generated-audio-model");
		expect(models).toEqual(
			expect.objectContaining({
				"generated-image-model": expect.any(Object),
				"generated-video-model": expect.any(Object),
				"mixed-video-model": expect.any(Object),
			}),
		);
	});

	it("does not inherit Ollama Cloud chat models without host-known models", async () => {
		gatewayMock.curatedCollectionsByProvider.ollama = { models: {} };
		gatewayMock.generatedModelsByProvider.ollama = {
			"cloud-chat-model": {
				id: "cloud-chat-model",
				modalities: { input: ["text"], output: ["text"] },
			},
		};
		const { resolveKnownModelsFromConfig } = await import("./handler-factory");

		expect(
			resolveKnownModelsFromConfig({
				providerId: "ollama",
				modelId: "local-model",
				systemPrompt: "",
				tools: [],
			}),
		).toBeUndefined();
	});

	it("forwards effective telemetry into the gateway", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");
		const logger = {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		};
		const telemetry = {
			capture: vi.fn(),
		} as unknown as ITelemetryService;
		const model = {} as AgentModel;
		gatewayMock.createAgentModel.mockReturnValue(model);

		const result = createAgentModelFromConfig(
			{
				providerId: "mock-provider",
				modelId: "mock-model",
				apiKey: "key",
				systemPrompt: "",
				tools: [],
			},
			logger,
			telemetry,
		);

		expect(result).toBe(model);
		expect(gatewayMock.createGateway).toHaveBeenCalledWith(
			expect.objectContaining({
				logger,
				telemetry,
			}),
		);
	});

	it("falls back to config telemetry when no override is supplied", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");
		const telemetry = {
			capture: vi.fn(),
		} as unknown as ITelemetryService;

		createAgentModelFromConfig(
			{
				providerId: "mock-provider",
				modelId: "mock-model",
				apiKey: "key",
				systemPrompt: "",
				tools: [],
				telemetry,
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				telemetry,
			}),
		);
	});

	it("forwards a host-provided fetch into the gateway (top-level and per-provider)", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");
		const hostFetch = vi.fn() as unknown as typeof fetch;

		createAgentModelFromConfig(
			{
				providerId: "openai-compatible",
				modelId: "mock-model",
				apiKey: "key",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "openai-compatible",
					modelId: "mock-model",
					fetch: hostFetch,
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				fetch: hostFetch,
				providerConfigs: [
					expect.objectContaining({
						providerId: "openai-compatible",
						fetch: hostFetch,
					}),
				],
			}),
		);
	});

	it("preserves model capabilities and metadata when configuring gateway models", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "openrouter",
				modelId: "qwen/qwen3.6-plus",
				apiKey: "test-key",
				systemPrompt: "",
				tools: [],
				knownModels: {
					"qwen/qwen3.6-plus": {
						id: "qwen/qwen3.6-plus",
						name: "Qwen3.6 Plus",
						contextWindow: 1_000_000,
						maxInputTokens: 1_000_000,
						maxTokens: 65_536,
						modalities: {
							input: ["text", "image"],
							output: ["text", "image"],
						},
						capabilities: [
							"tools",
							"reasoning",
							"structured_output",
							"prompt-cache",
						],
						pricing: {
							input: 0.325,
							output: 1.95,
							cacheRead: 0.0325,
							cacheWrite: 0.40625,
						},
						releaseDate: "2026-04-02",
						family: "qwen",
					},
				},
			} satisfies AgentConfig,
			undefined,
		);

		const gatewayConfig = (
			gatewayMock.createGateway.mock.calls as unknown as Array<
				[
					{
						providerConfigs: Array<{
							models: Array<Record<string, unknown>>;
						}>;
					},
				]
			>
		)[0][0];
		const model = gatewayConfig.providerConfigs[0].models[0];
		expect(model).toMatchObject({
			id: "qwen/qwen3.6-plus",
			name: "Qwen3.6 Plus",
			contextWindow: 1_000_000,
			maxInputTokens: 1_000_000,
			maxOutputTokens: 65_536,
			modalities: {
				input: ["text", "image"],
				output: ["text", "image"],
			},
			capabilities: expect.arrayContaining([
				"text",
				"tools",
				"reasoning",
				"structured-output",
				"prompt-cache",
			]),
			metadata: {
				family: "qwen",
				pricing: {
					input: 0.325,
					output: 1.95,
					cacheRead: 0.0325,
					cacheWrite: 0.40625,
				},
				releaseDate: "2026-04-02",
			},
		});
	});

	it("uses explicit per-turn max tokens and temperature for gateway request limits", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "openai-compatible",
				modelId: "custom-model",
				apiKey: "key",
				systemPrompt: "",
				tools: [],
				maxTokensPerTurn: 4_096,
				temperature: 0,
				providerConfig: {
					providerId: "openai-compatible",
					modelId: "custom-model",
				},
			},
			undefined,
		);

		expect(gatewayMock.createAgentModel).toHaveBeenLastCalledWith(
			{ providerId: "openai-compatible", modelId: "custom-model" },
			{ maxTokens: 4_096, temperature: 0 },
		);
	});

	it("forwards Bedrock AWS settings as gateway provider options", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "bedrock",
				modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "bedrock",
					modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
					region: "us-west-2",
					aws: {
						authentication: "profile",
						profile: "dev-profile",
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "bedrock",
						options: expect.objectContaining({
							region: "us-west-2",
							authentication: "profile",
							profile: "dev-profile",
						}),
					}),
				],
			}),
		);
	});

	it("forwards Vertex GCP settings as gateway provider options", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "vertex",
				modelId: "gemini-3-flash-preview",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "vertex",
					modelId: "gemini-3-flash-preview",
					gcp: {
						projectId: "test-project",
						region: "global",
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "vertex",
						options: expect.objectContaining({
							project: "test-project",
							projectId: "test-project",
							location: "global",
							region: "global",
						}),
					}),
				],
			}),
		);
	});

	it("forwards a caller-supplied timeout to the gateway provider config", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "ollama",
				modelId: "minimax-m3:cloud",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "ollama",
					modelId: "minimax-m3:cloud",
					timeoutMs: 180000,
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "ollama",
						timeoutMs: 180000,
					}),
				],
			}),
		);
	});

	it("projects providers.json contextWindow (maxInputTokens) onto the selected gateway model", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "ollama",
				modelId: "llama3.1",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "ollama",
					modelId: "llama3.1",
					// Where ProviderSettings.contextWindow lands via toProviderConfig.
					maxInputTokens: 8192,
					knownModels: {
						"llama3.1": {
							id: "llama3.1",
							name: "llama3.1",
							contextWindow: 131072,
						},
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "ollama",
						models: [
							expect.objectContaining({
								id: "llama3.1",
								contextWindow: 8192,
								maxInputTokens: 8192,
							}),
						],
					}),
				],
			}),
		);
	});

	it("surfaces a caller-supplied modelInfo for the selected model as a gateway model definition", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "ollama",
				modelId: "minimax-m3:cloud",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "ollama",
					modelId: "minimax-m3:cloud",
					modelInfo: {
						id: "minimax-m3:cloud",
						name: "minimax-m3:cloud",
						contextWindow: 500000,
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "ollama",
						models: [
							expect.objectContaining({
								id: "minimax-m3:cloud",
								contextWindow: 500000,
							}),
						],
					}),
				],
			}),
		);
	});

	it("ignores a caller-supplied modelInfo for a different model id", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "ollama",
				modelId: "llama3.1",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "ollama",
					modelId: "llama3.1",
					modelInfo: {
						id: "some-other-model",
						contextWindow: 500000,
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "ollama",
						models: undefined,
					}),
				],
			}),
		);
	});

	it("forwards SAP AI Core settings as gateway provider options", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "sapaicore",
				modelId: "anthropic--claude-4.6-sonnet",
				baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "sapaicore",
					modelId: "anthropic--claude-4.6-sonnet",
					sap: {
						clientId: "sap-client",
						clientSecret: "sap-secret",
						tokenUrl: "https://auth.example",
						resourceGroup: "default",
						deploymentId: "deployment-id",
						useOrchestrationMode: false,
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "sapaicore",
						baseUrl: "https://api.ai.example.aws.ml.hana.ondemand.com",
						options: expect.objectContaining({
							clientId: "sap-client",
							clientSecret: "sap-secret",
							tokenUrl: "https://auth.example",
							resourceGroup: "default",
							deploymentId: "deployment-id",
							useOrchestrationMode: false,
						}),
					}),
				],
			}),
		);

		const gatewayConfig = (
			gatewayMock.createGateway.mock.calls as unknown as Array<
				[
					{
						providerConfigs: Array<Record<string, unknown>>;
					},
				]
			>
		).at(-1)?.[0];
		const { createSapAiCoreProviderModule } = await import(
			// biome-ignore lint/style/noRestrictedImports: test asserts internal SAP provider module behavior not exposed via @cline/llms entrypoint
			"../../../../llms/src/providers/vendors/community"
		);
		const provider = await createSapAiCoreProviderModule(
			gatewayConfig?.providerConfigs[0] as never,
		);
		const model = provider.model("anthropic--claude-4.6-sonnet") as {
			config?: {
				destination?: Record<string, unknown>;
				deploymentConfig?: Record<string, unknown>;
				providerApi?: string;
			};
		};

		expect(model.config?.destination).toBeUndefined();
		expect(model.config?.deploymentConfig).toMatchObject({
			deploymentId: "deployment-id",
		});
		expect(model.config?.providerApi).toBe("foundation-models");
	});

	it("forwards Azure settings as OpenAI-compatible gateway provider options", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "openai-compatible",
				modelId: "gpt-4.1",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "openai-compatible",
					modelId: "gpt-4.1",
					azure: {
						apiVersion: "2025-01-01-preview",
						useIdentity: false,
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "openai-compatible",
						options: expect.objectContaining({
							apiVersion: "2025-01-01-preview",
							useIdentity: false,
						}),
					}),
				],
			}),
		);
	});

	it("does not forward Azure settings for non-OpenAI-compatible providers", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "anthropic",
				modelId: "claude-3-5-sonnet",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "anthropic",
					modelId: "claude-3-5-sonnet",
					azure: {
						apiVersion: "2025-01-01-preview",
						useIdentity: false,
					},
				},
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providerConfigs: [
					expect.objectContaining({
						providerId: "anthropic",
						options: undefined,
					}),
				],
			}),
		);
	});

	it("uses a registered handler (adapter) instead of the gateway, building it lazily", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		// Pretend a host handler is registered for this provider.
		gatewayMock.hasRegisteredHandler.mockReturnValue(true);
		const apiHandler = {
			getMessages: () => [],
			getModel: () => ({ id: "vscode-lm", info: { id: "vscode-lm" } }),
			// eslint-disable-next-line require-yield
			async *createMessage() {
				/* no chunks for this assertion */
			},
		};
		// createHandlerAsync resolves both sync- and async-registered handlers.
		gatewayMock.createHandlerAsync.mockResolvedValue(apiHandler);

		const result = createAgentModelFromConfig(
			{
				providerId: "vscode-lm",
				modelId: "copilot/claude-sonnet",
				apiKey: "",
				systemPrompt: "",
				tools: [],
			},
			undefined,
		);

		// The gateway is not used, and the AgentModel surface is exposed.
		expect(gatewayMock.createGateway).not.toHaveBeenCalled();
		expect(typeof result.stream).toBe("function");

		// The handler is resolved lazily — only once the stream is consumed.
		expect(gatewayMock.createHandlerAsync).not.toHaveBeenCalled();
		for await (const _ of await result.stream({
			systemPrompt: "",
			messages: [],
			tools: [],
		})) {
			// drain
		}
		expect(gatewayMock.createHandlerAsync).toHaveBeenCalledTimes(1);
	});
});
