import type { AgentConfig, AgentModel, ITelemetryService } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMock = vi.hoisted(() => {
	const createAgentModel = vi.fn();
	return {
		createAgentModel,
		createGateway: vi.fn(() => ({ createAgentModel })),
		// Registry helpers used by createAgentModelFromConfig. Default to "no
		// registered handler" so existing tests exercise the gateway path.
		hasRegisteredHandler: vi.fn(() => false),
		createHandlerAsync: vi.fn(),
	};
});

vi.mock("@cline/llms", () => ({
	createGateway: gatewayMock.createGateway,
	MODEL_COLLECTIONS_BY_PROVIDER_ID: {},
	hasRegisteredHandler: gatewayMock.hasRegisteredHandler,
	createHandlerAsync: gatewayMock.createHandlerAsync,
	normalizeProviderId: (id: string) => id,
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

	it("falls back to providerConfig maxOutputTokens when maxTokensPerTurn is unset", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "openai-compatible",
				modelId: "my-custom-model",
				apiKey: "test-key",
				systemPrompt: "",
				tools: [],
				providerConfig: {
					providerId: "openai-compatible",
					modelId: "my-custom-model",
					maxOutputTokens: 8_192,
				},
			} satisfies AgentConfig,
			undefined,
		);

		expect(gatewayMock.createAgentModel).toHaveBeenLastCalledWith(
			{ providerId: "openai-compatible", modelId: "my-custom-model" },
			{ maxTokens: 8_192 },
		);
	});

	it("prefers maxTokensPerTurn over providerConfig maxOutputTokens", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");

		createAgentModelFromConfig(
			{
				providerId: "openai-compatible",
				modelId: "my-custom-model",
				apiKey: "test-key",
				systemPrompt: "",
				tools: [],
				maxTokensPerTurn: 4_096,
				providerConfig: {
					providerId: "openai-compatible",
					modelId: "my-custom-model",
					maxOutputTokens: 8_192,
				},
			} satisfies AgentConfig,
			undefined,
		);

		expect(gatewayMock.createAgentModel).toHaveBeenLastCalledWith(
			{ providerId: "openai-compatible", modelId: "my-custom-model" },
			{ maxTokens: 4_096 },
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
