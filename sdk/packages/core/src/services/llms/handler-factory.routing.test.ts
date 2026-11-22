import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Llms from "@cline/llms";
import type { AgentModelEvent, ModelInfo } from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderSettingsManager } from "../storage/provider-settings-manager";
import {
	createAgentModelFromConfig,
	resolveKnownModelsFromConfig,
} from "./handler-factory";
import { resolveProviderConfig } from "./provider-defaults";
import { toProviderConfig } from "./provider-settings";

describe("core agent per-model protocol routing", () => {
	it.each([
		["muse-spark-1.3-contributor", "responses", "input"],
		["minimax-m3", "messages", "messages"],
		["qwen3.7-plus", "messages", "messages"],
		["glm-5.3", "chat/completions", "messages"],
	])("routes catalog model %s to %s without a provider-wide override", async (modelId, endpoint, inputField) => {
		const providerConfig = toProviderConfig({
			provider: "opencode-go",
			model: modelId,
			apiKey: "test-key",
		});
		expect(providerConfig.routingProviderId).toBeUndefined();
		await expectEndpoint(providerConfig, endpoint, inputField);
	});

	it.each<{
		protocol: NonNullable<ModelInfo["metadata"]>["apiProtocol"];
		endpoint: string;
		inputField: string;
	}>([
		{
			protocol: "openai-responses",
			endpoint: "responses",
			inputField: "input",
		},
		{ protocol: "anthropic", endpoint: "messages", inputField: "messages" },
		{
			protocol: "gemini",
			endpoint: "models/live-model:streamGenerateContent?alt=sse",
			inputField: "contents",
		},
		{
			protocol: "openai-chat",
			endpoint: "chat/completions",
			inputField: "messages",
		},
		{
			protocol: undefined,
			endpoint: "chat/completions",
			inputField: "messages",
		},
	])("routes a dynamically supplied $protocol model to $endpoint", async ({
		protocol,
		endpoint,
		inputField,
	}) => {
		await expectEndpoint(
			{
				...toProviderConfig({
					provider: "opencode-go",
					model: "live-model",
					apiKey: "test-key",
				}),
				knownModels: {
					"live-model": {
						id: "live-model",
						...(protocol ? { metadata: { apiProtocol: protocol } } : {}),
					},
				},
			},
			endpoint,
			inputField,
		);
	});
});

async function expectEndpoint(
	providerConfig: ReturnType<typeof toProviderConfig>,
	endpoint: string,
	inputField: string,
) {
	// Exercise the real gateway and HTTP serializers, but stop at the network
	// boundary. A non-retryable response keeps this test offline and deterministic.
	const fetchMock = vi.fn(
		async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
			Response.json(
				{ error: { message: "Routing test stopped at the network boundary" } },
				{ status: 400 },
			),
	);
	const model = createAgentModelFromConfig(
		{
			providerId: providerConfig.providerId,
			modelId: providerConfig.modelId,
			providerConfig: { ...providerConfig, fetch: fetchMock },
			systemPrompt: "",
			tools: [],
		},
		{ debug: vi.fn(), log: vi.fn(), error: vi.fn() },
	);
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream({
		messages: [
			{
				id: "routing-test-message",
				createdAt: 0,
				role: "user",
				content: [{ type: "text", text: "Hello" }],
			},
		],
		tools: [],
	})) {
		events.push(event);
	}
	expect(events).toContainEqual(
		expect.objectContaining({ type: "finish", reason: "error" }),
	);
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const [url, init] = fetchMock.mock.calls[0];
	expect(String(url)).toBe(`https://opencode.ai/inference/go/v1/${endpoint}`);
	const body = JSON.parse(String(init?.body));
	expect(body[inputField]).toBeDefined();
	if (inputField !== "contents") {
		expect(body.model).toBe(providerConfig.modelId);
	}
	if (inputField === "input") {
		expect(body.messages).toBeUndefined();
	}
}

describe("unlisted model max_tokens propagation (cline/cline#15803)", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		Llms.resetRegistry();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function createTempSettingsFiles(options: {
		providersJson?: Record<string, unknown>;
		modelsJson?: Record<string, unknown>;
	}): ProviderSettingsManager {
		const dir = mkdtempSync(path.join(os.tmpdir(), "cline-15803-test-"));
		tempDirs.push(dir);
		const settingsDir = path.join(dir, "settings");
		mkdirSync(settingsDir, { recursive: true });
		const providersPath = path.join(settingsDir, "providers.json");
		if (options.modelsJson) {
			writeFileSync(
				path.join(settingsDir, "models.json"),
				`${JSON.stringify(options.modelsJson, null, 2)}\n`,
			);
		}
		if (options.providersJson) {
			writeFileSync(
				providersPath,
				`${JSON.stringify(options.providersJson, null, 2)}\n`,
			);
		}
		return new ProviderSettingsManager({ filePath: providersPath });
	}

	async function captureWireRequestBody(options: {
		providerId: string;
		modelId: string;
		providerConfig: ReturnType<typeof toProviderConfig>;
		knownModels?: Record<string, ModelInfo>;
		maxTokensPerTurn?: number;
	}): Promise<{
		body: Record<string, unknown>;
		resolvedModelInfo: ModelInfo | undefined;
	}> {
		const fetchMock = vi.fn(
			async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
				Response.json(
					{ error: { message: "Stopped at wire boundary" } },
					{ status: 400 },
				),
		);
		const agentConfig = {
			providerId: options.providerId,
			modelId: options.modelId,
			apiKey: options.providerConfig.apiKey ?? "test-key",
			baseUrl: options.providerConfig.baseUrl,
			knownModels: options.knownModels,
			maxTokensPerTurn: options.maxTokensPerTurn,
			providerConfig: {
				...options.providerConfig,
				...(options.knownModels ? { knownModels: options.knownModels } : {}),
				fetch: fetchMock,
			},
			systemPrompt: "",
			tools: [],
		};
		const resolvedModelInfo =
			resolveKnownModelsFromConfig(agentConfig)?.[options.modelId];
		const model = createAgentModelFromConfig(agentConfig, {
			debug: vi.fn(),
			log: vi.fn(),
			error: vi.fn(),
		});
		for await (const _event of await model.stream({
			messages: [
				{
					id: "wire-test-msg",
					createdAt: 0,
					role: "user",
					content: [{ type: "text", text: "Reply READY." }],
				},
			],
			tools: [],
		})) {
			// drain stream
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [, init] = fetchMock.mock.calls[0];
		return {
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			resolvedModelInfo,
		};
	}

	it.each([
		["maxTokens", { maxTokens: 200_000 }],
		["maxOutputTokens", { maxOutputTokens: 200_000 }],
	])("honors models.json %s for an unlisted model on a built-in provider", async (_fieldName, tokenField) => {
		const manager = createTempSettingsFiles({
			modelsJson: {
				version: 1,
				providers: {
					"alibaba-cn": {
						models: {
							"qwen4-max": {
								id: "qwen4-max",
								name: "Qwen4 Max",
								contextWindow: 256_000,
								maxInputTokens: 256_000,
								...tokenField,
								capabilities: ["tools", "reasoning", "streaming"],
							},
						},
					},
				},
			},
			providersJson: {
				version: 1,
				providers: {
					"alibaba-cn": {
						settings: {
							provider: "alibaba-cn",
							apiKey: "test-key",
							baseUrl: "http://127.0.0.1:8731/v1",
							model: "qwen4-max",
						},
						updatedAt: "2026-01-01T00:00:00.000Z",
						tokenSource: "manual",
					},
				},
			},
		});

		const persisted = manager.getProviderConfig("alibaba-cn", {
			includeKnownModels: false,
		});
		const resolved = await resolveProviderConfig(
			"alibaba-cn",
			undefined,
			persisted,
		);
		const storedSettings = manager.getProviderSettings("alibaba-cn");
		if (!storedSettings) {
			throw new Error("expected stored alibaba-cn settings");
		}
		const providerConfig = toProviderConfig(storedSettings);

		const { body, resolvedModelInfo } = await captureWireRequestBody({
			providerId: "alibaba-cn",
			modelId: "qwen4-max",
			providerConfig,
			knownModels: resolved?.knownModels,
		});

		expect(resolvedModelInfo).toMatchObject({
			id: "qwen4-max",
			name: "Qwen4 Max",
			contextWindow: 256_000,
			maxInputTokens: 256_000,
			maxTokens: 200_000,
		});
		// No explicit providers.json maxTokens override: 30% of 200_000 beats the 32_000 floor.
		expect(body.max_tokens).toBe(60_000);
	});

	it.each([
		32_768, 200_000,
	])("honors explicit providers.json maxTokens=%i alongside contextWindow for an unlisted model", async (declaredMaxTokens) => {
		const manager = createTempSettingsFiles({
			providersJson: {
				version: 1,
				providers: {
					"alibaba-cn": {
						settings: {
							provider: "alibaba-cn",
							apiKey: "test-key",
							baseUrl: "http://127.0.0.1:8731/v1",
							model: "qwen4-max",
							contextWindow: 256_000,
							maxTokens: declaredMaxTokens,
						},
						updatedAt: "2026-01-01T00:00:00.000Z",
						tokenSource: "manual",
					},
				},
			},
		});

		const storedSettings = manager.getProviderSettings("alibaba-cn");
		if (!storedSettings) {
			throw new Error("expected stored alibaba-cn settings");
		}
		const providerConfig = toProviderConfig(storedSettings);

		const { body, resolvedModelInfo } = await captureWireRequestBody({
			providerId: "alibaba-cn",
			modelId: "qwen4-max",
			providerConfig,
		});

		expect(resolvedModelInfo).toMatchObject({
			id: "qwen4-max",
			contextWindow: 256_000,
			maxInputTokens: 256_000,
			maxTokens: declaredMaxTokens,
		});
		expect(body.max_tokens).toBe(declaredMaxTokens);
	});

	it.each([
		{ settingsMax: 200_000, modelMax: 200_000, expected: 200_000 },
		{ settingsMax: 200_000, modelMax: 131_072, expected: 131_072 },
		{ settingsMax: 32_768, modelMax: 200_000, expected: 32_768 },
	])("combines providers.json maxTokens=$settingsMax and models.json maxTokens=$modelMax to wire $expected", async ({
		settingsMax,
		modelMax,
		expected,
	}) => {
		const manager = createTempSettingsFiles({
			modelsJson: {
				version: 1,
				providers: {
					"alibaba-cn": {
						models: {
							"qwen4-max": {
								id: "qwen4-max",
								name: "Qwen4 Max",
								contextWindow: 256_000,
								maxInputTokens: 256_000,
								maxTokens: modelMax,
							},
						},
					},
				},
			},
			providersJson: {
				version: 1,
				providers: {
					"alibaba-cn": {
						settings: {
							provider: "alibaba-cn",
							apiKey: "test-key",
							baseUrl: "http://127.0.0.1:8731/v1",
							model: "qwen4-max",
							contextWindow: 256_000,
							maxTokens: settingsMax,
						},
						updatedAt: "2026-01-01T00:00:00.000Z",
						tokenSource: "manual",
					},
				},
			},
		});

		const storedSettings = manager.getProviderSettings("alibaba-cn");
		if (!storedSettings) {
			throw new Error("expected stored alibaba-cn settings");
		}
		const providerConfig = toProviderConfig(storedSettings);

		const { body, resolvedModelInfo } = await captureWireRequestBody({
			providerId: "alibaba-cn",
			modelId: "qwen4-max",
			providerConfig,
		});

		expect(resolvedModelInfo?.maxTokens).toBe(modelMax);
		expect(body.max_tokens).toBe(expected);
	});

	it("keeps existing catalog model max_tokens behavior unchanged when no overrides are configured", async () => {
		const providerConfig = toProviderConfig({
			provider: "alibaba-cn",
			apiKey: "test-key",
			baseUrl: "http://127.0.0.1:8731/v1",
			model: "qwen3.8-omni-flash",
		});
		const catalogModel = providerConfig.knownModels?.["qwen3.8-omni-flash"];
		expect(catalogModel?.maxTokens).toBeDefined();

		const { body } = await captureWireRequestBody({
			providerId: "alibaba-cn",
			modelId: "qwen3.8-omni-flash",
			providerConfig,
		});

		const catalogMax = catalogModel?.maxTokens;
		if (catalogMax === undefined) {
			throw new Error("expected bundled catalog maxTokens");
		}
		const expectedDefault = Math.min(
			catalogMax,
			Math.max(32_000, Math.floor(catalogMax * 0.3)),
		);
		expect(body.max_tokens).toBe(expectedDefault);
	});
});
