import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as LlmsModels from "@clinebot/llms/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSettingsManager } from "../storage/provider-settings-manager";
import {
	addLocalProvider,
	getLocalProviderModels,
	listLocalProviders,
	normalizeOAuthProvider,
	resolveLocalClineAuthToken,
	saveLocalProviderSettings,
} from "./local-provider-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempManager(): {
	manager: ProviderSettingsManager;
	cleanup: () => void;
} {
	const dir = mkdtempSync(
		path.join(os.tmpdir(), "local-provider-service-test-"),
	);
	const manager = new ProviderSettingsManager({
		filePath: path.join(dir, "providers.json"),
	});
	return {
		manager,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

// ---------------------------------------------------------------------------
// Shared state reset
// ---------------------------------------------------------------------------

afterEach(() => {
	LlmsModels.resetRegistry();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// ===========================================================================
// extractModelIdsFromPayload — tested indirectly via addLocalProvider
// ===========================================================================

describe("addLocalProvider – model ID parsing via modelsSourceUrl", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(() => {
		({ manager, cleanup } = makeTempManager());
	});

	afterEach(() => cleanup());

	it("parses a flat array payload from modelsSourceUrl", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ["alpha", "beta", "gamma"],
		});
		vi.stubGlobal("fetch", mockFetch);

		const result = await addLocalProvider(manager, {
			providerId: "flat-array-provider",
			name: "Flat Array",
			baseUrl: "https://example.invalid/v1",
			models: [],
			modelsSourceUrl: "https://example.invalid/models",
		});

		expect(result.modelsCount).toBe(3);
		const { models } = await getLocalProviderModels("flat-array-provider");
		expect(models.map((m) => m.id).sort()).toEqual(["alpha", "beta", "gamma"]);
	});

	it("parses a { data: [...] } payload from modelsSourceUrl", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ data: [{ id: "model-x" }, { id: "model-y" }] }),
			}),
		);

		await addLocalProvider(manager, {
			providerId: "data-array-provider",
			name: "Data Array",
			baseUrl: "https://example.invalid/v1",
			models: [],
			modelsSourceUrl: "https://example.invalid/models",
		});

		const { models } = await getLocalProviderModels("data-array-provider");
		expect(models.map((m) => m.id).sort()).toEqual(["model-x", "model-y"]);
	});

	it("parses a { models: { id1: {}, id2: {} } } object-keyed payload", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ models: { "key-a": {}, "key-b": {} } }),
			}),
		);

		await addLocalProvider(manager, {
			providerId: "obj-keys-provider",
			name: "Object Keys",
			baseUrl: "https://example.invalid/v1",
			models: [],
			modelsSourceUrl: "https://example.invalid/models",
		});

		const { models } = await getLocalProviderModels("obj-keys-provider");
		expect(models.map((m) => m.id).sort()).toEqual(["key-a", "key-b"]);
	});

	it("parses a { providers: { <id>: { models: [...] } } } nested payload", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					providers: {
						"nested-provider": { models: ["nested-a", "nested-b"] },
					},
				}),
			}),
		);

		await addLocalProvider(manager, {
			providerId: "nested-provider",
			name: "Nested Provider",
			baseUrl: "https://example.invalid/v1",
			models: [],
			modelsSourceUrl: "https://example.invalid/models",
		});

		const { models } = await getLocalProviderModels("nested-provider");
		expect(models.map((m) => m.id).sort()).toEqual(["nested-a", "nested-b"]);
	});

	it("merges manually specified models with fetched models and deduplicates", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ["fetched-1", "fetched-2", "manual-1"],
			}),
		);

		const result = await addLocalProvider(manager, {
			providerId: "merged-provider",
			name: "Merged",
			baseUrl: "https://example.invalid/v1",
			models: ["manual-1", "manual-2"],
			modelsSourceUrl: "https://example.invalid/models",
		});

		// manual-1, manual-2, fetched-1, fetched-2, manual-1 → Set → 4
		expect(result.modelsCount).toBe(4);
		const { models } = await getLocalProviderModels("merged-provider");
		const ids = models.map((m) => m.id).sort();
		expect(ids).toEqual(["fetched-1", "fetched-2", "manual-1", "manual-2"]);
	});

	it("throws when fetch returns non-OK status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
			}),
		);

		await expect(
			addLocalProvider(manager, {
				providerId: "fail-fetch-provider",
				name: "Fail",
				baseUrl: "https://example.invalid/v1",
				models: [],
				modelsSourceUrl: "https://example.invalid/models",
			}),
		).rejects.toThrow("HTTP 404");
	});

	it("ignores empty string entries in array payloads", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ["good-model", "", "  "],
			}),
		);

		await addLocalProvider(manager, {
			providerId: "empty-strings-provider",
			name: "Empty Strings",
			baseUrl: "https://example.invalid/v1",
			models: [],
			modelsSourceUrl: "https://example.invalid/models",
		});

		const { models } = await getLocalProviderModels("empty-strings-provider");
		expect(models.map((m) => m.id)).toEqual(["good-model"]);
	});

	it("ignores non-array, non-object payload shapes and falls back to manual models", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => "just a string",
			}),
		);

		await addLocalProvider(manager, {
			providerId: "fallback-provider",
			name: "Fallback",
			baseUrl: "https://example.invalid/v1",
			models: ["fallback-model"],
			modelsSourceUrl: "https://example.invalid/models",
		});

		const { models } = await getLocalProviderModels("fallback-provider");
		expect(models.map((m) => m.id)).toEqual(["fallback-model"]);
	});
});

// ===========================================================================
// addLocalProvider – validation guards
// ===========================================================================

describe("addLocalProvider – validation", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(() => {
		({ manager, cleanup } = makeTempManager());
	});

	afterEach(() => cleanup());

	it("throws when providerId is empty", async () => {
		await expect(
			addLocalProvider(manager, {
				providerId: "   ",
				name: "X",
				baseUrl: "https://example.invalid",
				models: ["m"],
			}),
		).rejects.toThrow("providerId is required");
	});

	it("throws when name is empty", async () => {
		await expect(
			addLocalProvider(manager, {
				providerId: "my-provider",
				name: "   ",
				baseUrl: "https://example.invalid",
				models: ["m"],
			}),
		).rejects.toThrow("name is required");
	});

	it("throws when baseUrl is empty", async () => {
		await expect(
			addLocalProvider(manager, {
				providerId: "my-provider2",
				name: "My Provider",
				baseUrl: "   ",
				models: ["m"],
			}),
		).rejects.toThrow("baseUrl is required");
	});

	it("throws when no models are provided and no modelsSourceUrl", async () => {
		await expect(
			addLocalProvider(manager, {
				providerId: "no-models-provider",
				name: "No Models",
				baseUrl: "https://example.invalid",
				models: [],
			}),
		).rejects.toThrow("at least one model is required");
	});

	it("throws when provider already exists", async () => {
		// Register a provider first
		await addLocalProvider(manager, {
			providerId: "duplicate-provider",
			name: "First",
			baseUrl: "https://example.invalid/v1",
			models: ["m1"],
		});

		await expect(
			addLocalProvider(manager, {
				providerId: "duplicate-provider",
				name: "Second",
				baseUrl: "https://example.invalid/v1",
				models: ["m2"],
			}),
		).rejects.toThrow('"duplicate-provider" already exists');
	});
});

// ===========================================================================
// addLocalProvider – defaultModelId selection
// ===========================================================================

describe("addLocalProvider – defaultModelId selection", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(() => {
		({ manager, cleanup } = makeTempManager());
	});

	afterEach(() => cleanup());

	it("uses explicit defaultModelId when it is in the model list", async () => {
		await addLocalProvider(manager, {
			providerId: "default-model-provider",
			name: "Test",
			baseUrl: "https://example.invalid/v1",
			models: ["model-a", "model-b", "model-c"],
			defaultModelId: "model-b",
		});

		const settings = manager.getProviderSettings("default-model-provider");
		expect(settings?.model).toBe("model-b");
	});

	it("falls back to the first model when defaultModelId is not in the list", async () => {
		await addLocalProvider(manager, {
			providerId: "fallback-default-provider",
			name: "Test",
			baseUrl: "https://example.invalid/v1",
			models: ["model-a", "model-b"],
			defaultModelId: "not-in-list",
		});

		const settings = manager.getProviderSettings("fallback-default-provider");
		expect(settings?.model).toBe("model-a");
	});
});

// ===========================================================================
// addLocalProvider – capabilities → vision / reasoning flags
// ===========================================================================

describe("addLocalProvider – capabilities", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(() => {
		({ manager, cleanup } = makeTempManager());
	});

	afterEach(() => cleanup());

	it("sets supportsVision and supportsAttachments when capability is 'vision'", async () => {
		await addLocalProvider(manager, {
			providerId: "vision-provider",
			name: "Vision",
			baseUrl: "https://example.invalid/v1",
			models: ["vis-model"],
			capabilities: ["vision"],
		});

		const { models } = await getLocalProviderModels("vision-provider");
		expect(models).toHaveLength(1);
		expect(models[0].supportsVision).toBe(true);
		expect(models[0].supportsAttachments).toBe(true);
	});

	it("sets supportsReasoning when capability is 'reasoning'", async () => {
		await addLocalProvider(manager, {
			providerId: "reasoning-provider",
			name: "Reasoning",
			baseUrl: "https://example.invalid/v1",
			models: ["r-model"],
			capabilities: ["reasoning"],
		});

		const { models } = await getLocalProviderModels("reasoning-provider");
		expect(models[0].supportsReasoning).toBe(true);
		expect(models[0].supportsVision).toBeFalsy();
	});

	it("does not set vision/reasoning flags when capabilities are absent", async () => {
		await addLocalProvider(manager, {
			providerId: "plain-provider",
			name: "Plain",
			baseUrl: "https://example.invalid/v1",
			models: ["plain-model"],
		});

		const { models } = await getLocalProviderModels("plain-provider");
		expect(models[0].supportsVision).toBeFalsy();
		expect(models[0].supportsReasoning).toBeFalsy();
	});

	it("merges LiteLLM private models into the provider model listing when auth is configured", async () => {
		manager.saveProviderSettings(
			{
				provider: "litellm",
				apiKey: "test-key-catalog",
				baseUrl: "http://localhost:4010",
				model: "gpt-4o",
			},
			{ setLastUsed: false },
		);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					data: [
						{
							model_name: "private-proxy-model",
							litellm_params: { model: "openai/gpt-4o-mini" },
							model_info: {
								supports_vision: true,
								supports_reasoning: true,
							},
						},
					],
				}),
			}),
		);

		const { models } = await getLocalProviderModels(
			"litellm",
			manager.getProviderConfig("litellm"),
		);

		expect(models.map((model) => model.id)).toContain("private-proxy-model");
		expect(models.map((model) => model.id)).toContain("openai/gpt-4o-mini");
		expect(
			models.find((model) => model.id === "private-proxy-model"),
		).toMatchObject({
			supportsVision: true,
			supportsReasoning: true,
		});
	});
});

// ===========================================================================
// saveLocalProviderSettings
// ===========================================================================

describe("saveLocalProviderSettings", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(async () => {
		({ manager, cleanup } = makeTempManager());
		// Seed a provider so there is something to operate on
		await addLocalProvider(manager, {
			providerId: "test-provider",
			name: "Test",
			baseUrl: "https://example.invalid/v1",
			models: ["m1"],
		});
	});

	afterEach(() => cleanup());

	it("disabling a provider removes it from settings", () => {
		const result = saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: false,
		});

		expect(result.enabled).toBe(false);
		expect(manager.getProviderSettings("test-provider")).toBeUndefined();
	});

	it("updates apiKey", () => {
		saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: true,
			apiKey: "new-key",
		});

		expect(manager.getProviderSettings("test-provider")?.apiKey).toBe(
			"new-key",
		);
	});

	it("clears apiKey when empty string is provided", () => {
		// First set a key
		saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: true,
			apiKey: "some-key",
		});
		// Then clear it
		saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: true,
			apiKey: "",
		});

		const settings = manager.getProviderSettings("test-provider");
		expect(settings).not.toHaveProperty("apiKey");
	});

	it("merges auth object rather than replacing it", () => {
		saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: true,
			auth: { accessToken: "tok1" },
		});
		saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: true,
			auth: { refreshToken: "ref1" },
		});

		const settings = manager.getProviderSettings("test-provider") as Record<
			string,
			unknown
		>;
		const auth = settings?.auth as Record<string, unknown>;
		expect(auth?.accessToken).toBe("tok1");
		expect(auth?.refreshToken).toBe("ref1");
	});

	it("passes through scalar fields like maxTokens and timeout", () => {
		saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: true,
			maxTokens: 4096,
			timeout: 30_000,
		});

		const settings = manager.getProviderSettings("test-provider") as Record<
			string,
			unknown
		>;
		expect(settings?.maxTokens).toBe(4096);
		expect(settings?.timeout).toBe(30_000);
	});

	it("disabling a last-used provider also clears lastUsedProvider", async () => {
		// Set test-provider as last used
		manager.saveProviderSettings(
			{ provider: "test-provider", model: "m1" },
			{ setLastUsed: true },
		);
		expect(manager.getLastUsedProviderSettings()?.provider).toBe(
			"test-provider",
		);

		saveLocalProviderSettings(manager, {
			providerId: "test-provider",
			enabled: false,
		});

		expect(manager.getLastUsedProviderSettings()).toBeUndefined();
	});
});

// ===========================================================================
// listLocalProviders
// ===========================================================================

describe("listLocalProviders", () => {
	let manager: ProviderSettingsManager;
	let cleanup: () => void;

	beforeEach(() => {
		({ manager, cleanup } = makeTempManager());
	});

	afterEach(() => cleanup());

	it("includes all registered providers", async () => {
		await addLocalProvider(manager, {
			providerId: "list-provider-a",
			name: "Provider A",
			baseUrl: "https://example.invalid/a",
			models: ["ma1"],
		});
		await addLocalProvider(manager, {
			providerId: "list-provider-b",
			name: "Provider B",
			baseUrl: "https://example.invalid/b",
			models: ["mb1"],
		});

		const { providers } = await listLocalProviders(manager);
		const ids = providers.map((p) => p.id);
		expect(ids).toContain("list-provider-a");
		expect(ids).toContain("list-provider-b");
	});

	it("marks enabled providers correctly", async () => {
		await addLocalProvider(manager, {
			providerId: "enabled-check-provider",
			name: "Enabled Check",
			baseUrl: "https://example.invalid/v1",
			models: ["m1"],
		});

		const { providers } = await listLocalProviders(manager);
		const p = providers.find((x) => x.id === "enabled-check-provider");
		expect(p?.enabled).toBe(true);
	});

	it("exposes model count", async () => {
		await addLocalProvider(manager, {
			providerId: "count-provider",
			name: "Count",
			baseUrl: "https://example.invalid/v1",
			models: ["x", "y", "z"],
		});

		const { providers } = await listLocalProviders(manager);
		const p = providers.find((x) => x.id === "count-provider");
		expect(p?.models).toBe(3);
	});

	it("generates a stable color and letter for each provider", async () => {
		await addLocalProvider(manager, {
			providerId: "color-letter-provider",
			name: "Color Letter",
			baseUrl: "https://example.invalid/v1",
			models: ["m1"],
		});

		const { providers } = await listLocalProviders(manager);
		const p = providers.find((x) => x.id === "color-letter-provider");
		expect(p?.color).toMatch(/^#[0-9a-f]{6}$/i);
		expect(p?.letter).toBeTruthy();
	});

	it("includes built-in model lists in the provider catalog path", async () => {
		manager.saveProviderSettings(
			{
				provider: "openai-native",
				apiKey: "test-key",
				baseUrl: "https://api.openai.com/v1",
				model: "gpt-5.3-codex",
			},
			{ setLastUsed: false },
		);

		const { providers } = await listLocalProviders(manager);
		const openai = providers.find(
			(provider) => provider.id === "openai-native",
		);

		expect(openai?.modelList?.length).toBeGreaterThan(0);
		expect(
			openai?.modelList?.some((model) => model.id === "gpt-5.3-codex"),
		).toBe(true);
	});

	it("does not eagerly fetch LiteLLM private models while listing providers", async () => {
		manager.saveProviderSettings(
			{
				provider: "litellm",
				apiKey: "test-key",
				baseUrl: "http://localhost:4000",
				model: "gpt-4o",
			},
			{ setLastUsed: false },
		);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				data: [
					{
						model_name: "team-private-model",
						litellm_params: { model: "team/private-model" },
						model_info: {},
					},
				],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { providers } = await listLocalProviders(manager);
		const litellm = providers.find((provider) => provider.id === "litellm");

		expect(fetchMock).not.toHaveBeenCalled();
		expect(litellm?.modelList).toEqual([]);
		expect(
			litellm?.modelList?.some((model) => model.id === "team/private-model"),
		).toBe(false);
	});
});

// ===========================================================================
// normalizeOAuthProvider
// ===========================================================================

describe("normalizeOAuthProvider", () => {
	it("normalizes 'cline' to 'cline'", () => {
		expect(normalizeOAuthProvider("cline")).toBe("cline");
		expect(normalizeOAuthProvider("  CLINE  ")).toBe("cline");
	});

	it("normalizes 'oca' to 'oca'", () => {
		expect(normalizeOAuthProvider("oca")).toBe("oca");
		expect(normalizeOAuthProvider("OCA")).toBe("oca");
	});

	it("normalizes 'codex' and 'openai-codex' to 'openai-codex'", () => {
		expect(normalizeOAuthProvider("codex")).toBe("openai-codex");
		expect(normalizeOAuthProvider("openai-codex")).toBe("openai-codex");
		expect(normalizeOAuthProvider("OPENAI-CODEX")).toBe("openai-codex");
	});

	it("throws for unsupported providers", () => {
		expect(() => normalizeOAuthProvider("anthropic")).toThrow(
			"does not support OAuth login",
		);
		expect(() => normalizeOAuthProvider("")).toThrow();
	});
});

// ===========================================================================
// resolveLocalClineAuthToken
// ===========================================================================

describe("resolveLocalClineAuthToken", () => {
	it("returns undefined when settings is undefined", () => {
		expect(resolveLocalClineAuthToken(undefined)).toBeUndefined();
	});

	it("returns accessToken when present", () => {
		expect(
			resolveLocalClineAuthToken({
				provider: "cline" as never,
				auth: { accessToken: "tok123" },
			}),
		).toBe("tok123");
	});

	it("falls back to apiKey when accessToken is absent", () => {
		expect(
			resolveLocalClineAuthToken({
				provider: "cline" as never,
				apiKey: "api-key-456",
			}),
		).toBe("api-key-456");
	});

	it("prefers accessToken over apiKey", () => {
		expect(
			resolveLocalClineAuthToken({
				provider: "cline" as never,
				apiKey: "api-key",
				auth: { accessToken: "access-token" },
			}),
		).toBe("access-token");
	});

	it("returns undefined when both accessToken and apiKey are empty strings", () => {
		expect(
			resolveLocalClineAuthToken({
				provider: "cline" as never,
				apiKey: "   ",
				auth: { accessToken: "  " },
			}),
		).toBeUndefined();
	});

	it("returns undefined when both fields are absent", () => {
		expect(
			resolveLocalClineAuthToken({ provider: "cline" as never }),
		).toBeUndefined();
	});
});
