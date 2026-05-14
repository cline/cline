import type { AgentConfig, AgentModel, ITelemetryService } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gatewayMock = vi.hoisted(() => {
	const createAgentModel = vi.fn();
	return {
		createAgentModel,
		createGateway: vi.fn(() => ({ createAgentModel })),
	};
});

vi.mock("@cline/llms", () => ({
	createGateway: gatewayMock.createGateway,
	MODEL_COLLECTIONS_BY_PROVIDER_ID: {},
}));

describe("createAgentModelFromConfig", () => {
	beforeEach(() => {
		gatewayMock.createAgentModel.mockReset();
		gatewayMock.createGateway.mockClear();
		gatewayMock.createGateway.mockImplementation(() => ({
			createAgentModel: gatewayMock.createAgentModel,
		}));
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

	it("forwards cloud provider options into the gateway provider config", async () => {
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
			} satisfies AgentConfig,
			undefined,
		);

		const gatewayConfig = (
			gatewayMock.createGateway.mock.calls as unknown as Array<
				[
					{
						providerConfigs: Array<{
							options?: Record<string, unknown>;
						}>;
					},
				]
			>
		)[0][0];

		expect(gatewayConfig.providerConfigs[0].options).toMatchObject({
			project: "test-project",
			projectId: "test-project",
			region: "global",
			location: "global",
		});
	});
});
