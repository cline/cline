import { describe, expect, it, vi } from "vitest"
import type { EffectiveProviderConfig, ProviderCatalog, ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import type { ProviderCatalogController } from "../providerCatalogShared"

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
		resolveModels: vi.fn(),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
	}
}

function makeController(store: ProviderConfigStore, catalog: ProviderCatalog): ProviderCatalogController {
	return {
		getProviderConfigStore: () => store,
		getProviderCatalog: () => catalog,
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
		expect(catalog.resolveModels).not.toHaveBeenCalled()
		expect(store.commitSelection).not.toHaveBeenCalled()
		expect(store.write).not.toHaveBeenCalled()
	})

	it("returns sdk-known-models source for a known SDK model without a committed selection", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		const catalog = makeCatalog()

		const response = await resolveModelInfo(makeController(store, catalog), {
			providerId: "deepseek",
			modelId: "deepseek-v4-pro",
		})

		expect(response.source).toBe("sdk-known-models")
		expect(response.modelId).toBe("deepseek-v4-pro")
		expect(response.modelInfo?.contextWindow).toBe(1_000_000)
		expect(catalog.resolveModels).not.toHaveBeenCalled()
	})

	it("returns sdk-default source when model id is omitted", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const providerId = parseProviderId("deepseek")
		const response = await resolveModelInfo(makeController(makeStore({ providerId }), makeCatalog()), {
			providerId: "deepseek",
		})

		expect(response.source).toBe("sdk-default")
		expect(response.modelId).toBe("deepseek-v4-flash")
		expect(response.modelInfo?.contextWindow).toBe(1_000_000)
	})

	it("returns sdk-default source when model id belongs to another provider", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const providerId = parseProviderId("deepseek")
		const response = await resolveModelInfo(makeController(makeStore({ providerId }), makeCatalog()), {
			providerId: "deepseek",
			modelId: "claude-sonnet-4-5-20250929",
		})

		expect(response.source).toBe("sdk-default")
		expect(response.modelId).toBe("deepseek-v4-flash")
		expect(response.modelInfo?.contextWindow).toBe(1_000_000)
	})

	it("returns unknown source for an unknown provider", async () => {
		const { resolveModelInfo } = await import("../resolveModelInfo")
		const providerId = parseProviderId("not-real-provider")
		const response = await resolveModelInfo(makeController(makeStore({ providerId }), makeCatalog()), {
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
