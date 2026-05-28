import { describe, expect, it, vi } from "vitest"
import type {
	EffectiveProviderConfig,
	ModelInfo,
	ProviderCatalog,
	ProviderConfigStore,
	ProviderId,
	ProviderModelsResult,
} from "@/sdk/model-catalog/contracts"
import { computeConfigFingerprint } from "@/sdk/model-catalog/fingerprint"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "../providerCatalogShared"

function fingerprint(providerId: ProviderId): ReturnType<typeof computeConfigFingerprint> {
	return computeConfigFingerprint(providerId, { providerId })
}

function makeStore(config: EffectiveProviderConfig): ProviderConfigStore {
	return {
		read: vi.fn(() => config),
		readSelection: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		write: vi.fn(() => config),
		commitSelection: vi.fn(),
	}
}

function makeCatalog(): ProviderCatalog {
	return {
		listProviders: vi.fn(async () => []),
		resolveModels: vi.fn(async (providerId) => ({
			ok: true as const,
			providerId,
			configFingerprint: fingerprint(providerId),
			models: new Map<string, ModelInfo>(),
			defaultModelId: "",
			source: "sdk-dynamic" as const,
			fetchedAt: 0,
		})),
		peekModels: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}
}

function makeController(store: ProviderConfigStore, catalog: ProviderCatalog): ProviderCatalogController {
	return {
		getProviderConfigStore: () => store,
		getProviderCatalog: () => catalog,
	}
}

function peekResult(providerId: string, entries: Array<[string, ModelInfo]>, defaultModelId: string): ProviderModelsResult {
	return {
		ok: true,
		providerId: parseProviderId(providerId),
		configFingerprint: fingerprint(parseProviderId(providerId)),
		models: new Map(entries),
		defaultModelId,
		source: "sdk-dynamic" as const,
		fetchedAt: 0,
	}
}

describe("resolveModelInfo", () => {
	it("returns committed-selection source when a matching selection exists", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		vi.mocked(store.readSelection).mockImplementation((_, mode) =>
			mode === "act"
				? {
						providerId,
						modelId: "deepseek-v4-pro",
						modelInfo: { name: "Committed Pro", supportsPromptCache: true, contextWindow: 999_999 },
					}
				: undefined,
		)
		const catalog = makeCatalog()

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
		})

		expect(response.source).toBe("committed-selection")
		expect(response.modelId).toBe("deepseek-v4-pro")
		expect(response.modelInfo?.contextWindow).toBe(999_999)
		expect(catalog.peekModels).not.toHaveBeenCalled()
		expect(catalog.resolveModels).not.toHaveBeenCalled()
	})

	it("returns sdk-known-models from a populated catalog peek", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const store = makeStore({ providerId: parseProviderId("deepseek") })
		const catalog = makeCatalog()
		vi.mocked(catalog.peekModels).mockReturnValue(
			peekResult(
				"deepseek",
				[
					["deepseek-v4-pro", { name: "DeepSeek V4 Pro", supportsPromptCache: false, contextWindow: 1_000_000 }],
					["deepseek-v4-flash", { name: "DeepSeek V4 Flash", supportsPromptCache: false, contextWindow: 1_000_000 }],
				],
				"deepseek-v4-flash",
			),
		)

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
		})

		expect(response.source).toBe("sdk-known-models")
		expect(response.modelId).toBe("deepseek-v4-pro")
		expect(response.modelInfo?.contextWindow).toBe(1_000_000)
		expect(catalog.resolveModels).not.toHaveBeenCalled()
	})

	it("returns sdk-default when the requested id is missing but the catalog has a default", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const store = makeStore({ providerId: parseProviderId("deepseek") })
		const catalog = makeCatalog()
		vi.mocked(catalog.peekModels).mockReturnValue(
			peekResult(
				"deepseek",
				[["deepseek-v4-flash", { name: "DeepSeek V4 Flash", supportsPromptCache: false, contextWindow: 1_000_000 }]],
				"deepseek-v4-flash",
			),
		)

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "deepseek",
			modelId: "claude-sonnet-4-5-20250929",
		})

		expect(response.source).toBe("sdk-default")
		expect(response.modelId).toBe("deepseek-v4-flash")
		expect(response.modelInfo?.contextWindow).toBe(1_000_000)
		expect(catalog.resolveModels).not.toHaveBeenCalled()
	})

	it("returns sdk-default when the request omits a model id and the catalog has a default", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const store = makeStore({ providerId: parseProviderId("deepseek") })
		const catalog = makeCatalog()
		vi.mocked(catalog.peekModels).mockReturnValue(
			peekResult(
				"deepseek",
				[["deepseek-v4-flash", { name: "DeepSeek V4 Flash", supportsPromptCache: false, contextWindow: 1_000_000 }]],
				"deepseek-v4-flash",
			),
		)

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "deepseek",
		})

		expect(response.source).toBe("sdk-default")
		expect(response.modelId).toBe("deepseek-v4-flash")
		expect(response.modelInfo?.contextWindow).toBe(1_000_000)
	})

	it("awaits the catalog when the peek is empty and surfaces the resolved info", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const store = makeStore({ providerId: parseProviderId("deepseek") })
		const catalog = makeCatalog()
		// peek returns undefined (default). resolveModels returns a
		// populated catalog. The handler should await resolveModels and
		// pick from its result rather than returning unknown.
		vi.mocked(catalog.resolveModels).mockResolvedValue(
			peekResult(
				"deepseek",
				[["deepseek-v4-pro", { name: "DeepSeek V4 Pro", supportsPromptCache: false, contextWindow: 1_000_000 }]],
				"deepseek-v4-pro",
			),
		)

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
		})

		expect(response.source).toBe("sdk-known-models")
		expect(response.modelId).toBe("deepseek-v4-pro")
		expect(response.modelInfo?.contextWindow).toBe(1_000_000)
		expect(catalog.resolveModels).toHaveBeenCalledTimes(1)
	})

	it("returns unknown when both the peek and resolveModels yield nothing", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const store = makeStore({ providerId: parseProviderId("deepseek") })
		const catalog = makeCatalog()
		// Default peek mock returns undefined; default resolveModels mock
		// returns an empty catalog with no default model.

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
		})

		expect(response).toMatchObject({
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
			source: "unknown",
		})
		expect(response.modelInfo).toBeUndefined()
		expect(catalog.resolveModels).toHaveBeenCalledTimes(1)
	})

	it("returns unknown for an unknown provider without throwing", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const store = makeStore({ providerId: parseProviderId("not-real-provider") })
		const catalog = makeCatalog()

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "not-real-provider",
			modelId: "whatever",
		})

		expect(response).toMatchObject({
			providerId: "not-real-provider",
			modelId: "whatever",
			source: "unknown",
		})
		expect(response.modelInfo).toBeUndefined()
	})
})
