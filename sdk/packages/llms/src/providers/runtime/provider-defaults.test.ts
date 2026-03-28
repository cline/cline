import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo, ProviderConfig } from "../types/index";
import {
	clearLiveModelsCatalogCache,
	clearPrivateModelsCatalogCache,
	OPENAI_COMPATIBLE_PROVIDERS,
	resolveProviderConfig,
} from "./provider-defaults";

function createLiteLlmConfig(
	overrides?: Partial<ProviderConfig>,
): ProviderConfig {
	return {
		providerId: "litellm",
		modelId: "gpt-4o",
		apiKey: "test-key",
		baseUrl: "http://localhost:4000",
		...overrides,
	};
}

describe("resolveProviderConfig", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		clearLiveModelsCatalogCache();
		clearPrivateModelsCatalogCache();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("loads auth-gated private models and gives user knownModels highest priority", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				data: [
					{
						model_name: "gpt-4o",
						litellm_params: { model: "gpt-4o" },
						model_info: {
							max_tokens: 32000,
							max_input_tokens: 128000,
						},
					},
				],
			}),
		}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const userModel: ModelInfo = {
			id: "gpt-4o",
			name: "User Override",
			contextWindow: 999_999,
			maxTokens: 9_999,
			capabilities: ["streaming", "tools"],
		};

		const resolved = await resolveProviderConfig(
			"litellm",
			{ loadPrivateOnAuth: true },
			createLiteLlmConfig({
				knownModels: {
					"gpt-4o": userModel,
				},
			}),
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(resolved?.knownModels?.["gpt-4o"]).toEqual(userModel);
	});

	it("caches auth-gated private model responses by provider+baseUrl+token", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				data: [
					{
						model_name: "proxy-model",
						litellm_params: { model: "proxy-model" },
						model_info: {},
					},
				],
			}),
		}));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const config = createLiteLlmConfig();
		await resolveProviderConfig("litellm", { loadPrivateOnAuth: true }, config);
		await resolveProviderConfig("litellm", { loadPrivateOnAuth: true }, config);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not load auth-gated private models when disabled", async () => {
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await resolveProviderConfig(
			"litellm",
			{ loadPrivateOnAuth: false },
			createLiteLlmConfig(),
		);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("includes lmstudio and zai as OpenAI-compatible providers", () => {
		expect(OPENAI_COMPATIBLE_PROVIDERS).toHaveProperty("lmstudio");
		expect(OPENAI_COMPATIBLE_PROVIDERS).toHaveProperty("zai");
		expect(OPENAI_COMPATIBLE_PROVIDERS.lmstudio?.baseUrl).toBe(
			"http://localhost:1234/v1",
		);
		expect(OPENAI_COMPATIBLE_PROVIDERS.zai?.baseUrl).toBe(
			"https://api.z.ai/api/paas/v4",
		);
	});
});
