import type { AgentConfig, AgentModel, ITelemetryService } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMock = vi.hoisted(() => {
	const createAgentModel = vi.fn();
	const resolveGatewayProviderRegistrationSync = vi.fn();
	return {
		createAgentModel,
		createGateway: vi.fn(() => ({ createAgentModel })),
		resolveGatewayProviderRegistrationSync,
	};
});

vi.mock("@cline/llms", () => ({
	createGateway: gatewayMock.createGateway,
	MODEL_COLLECTIONS_BY_PROVIDER_ID: {},
	resolveGatewayProviderRegistrationSync:
		gatewayMock.resolveGatewayProviderRegistrationSync,
}));

describe("createAgentModelFromConfig", () => {
	beforeEach(() => {
		gatewayMock.createAgentModel.mockReset();
		gatewayMock.createGateway.mockClear();
		gatewayMock.resolveGatewayProviderRegistrationSync.mockReset();
		gatewayMock.createGateway.mockImplementation(() => ({
			createAgentModel: gatewayMock.createAgentModel,
		}));
	});

	it("registers catalog-backed providers with the gateway", async () => {
		const { createAgentModelFromConfig } = await import("./handler-factory");
		const registration = {
			manifest: {
				id: "plugin-provider",
				name: "Plugin Provider",
				defaultModelId: "plugin-model",
				models: [
					{
						id: "plugin-model",
						name: "Plugin Model",
						providerId: "plugin-provider",
					},
				],
			},
			createProvider: vi.fn(),
		};
		gatewayMock.resolveGatewayProviderRegistrationSync.mockReturnValue(
			registration,
		);

		createAgentModelFromConfig(
			{
				providerId: "plugin-provider",
				modelId: "plugin-model",
				apiKey: "key",
				systemPrompt: "",
				tools: [],
			},
			undefined,
		);

		expect(gatewayMock.createGateway).toHaveBeenCalledWith(
			expect.objectContaining({
				providers: [registration],
			}),
		);
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
});
