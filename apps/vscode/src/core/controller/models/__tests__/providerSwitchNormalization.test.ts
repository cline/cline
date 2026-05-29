import { MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { describe, expect, it, vi } from "vitest"
import type { EffectiveProviderConfig, ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { parseProviderId } from "@/sdk/model-catalog/provider-id"
import { normalizeProviderSwitchModel } from "../providerSwitchNormalization"

function makeStore(config: EffectiveProviderConfig): ProviderConfigStore {
	return {
		read: vi.fn(() => config),
		readSelection: vi.fn(() => undefined),
		subscribe: vi.fn(() => ({ dispose: vi.fn() })),
		write: vi.fn(() => config),
		commitSelection: vi.fn(),
	}
}

describe("normalizeProviderSwitchModel", () => {
	it("uses the SDK default when switching to DeepSeek with a stale Anthropic model id", () => {
		const providerId = parseProviderId("deepseek")
		const defaultModelId = MODEL_COLLECTIONS_BY_PROVIDER_ID.deepseek.provider.defaultModelId
		const store = makeStore({ providerId })

		const normalized = normalizeProviderSwitchModel(
			store,
			{ actModeApiProvider: "anthropic", actModeApiModelId: "claude-sonnet-4-5-20250929" },
			{ actModeApiProvider: "deepseek", actModeApiModelId: undefined },
		)

		expect(normalized.actModeApiProvider).toBe("deepseek")
		expect(normalized.actModeApiModelId).toBe(defaultModelId)
	})

	it("uses the SDK default when switching to Gemini with a stale DeepSeek model id", () => {
		const providerId = parseProviderId("gemini")
		const store = makeStore({ providerId })

		const normalized = normalizeProviderSwitchModel(
			store,
			{ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-flash" },
			{ actModeApiProvider: "gemini", actModeApiModelId: undefined },
		)

		expect(normalized.actModeApiProvider).toBe("gemini")
		// The Gemini SDK manifest currently has a provider default that is not in
		// the generated model catalog. Provider-switch normalization must match the
		// model picker/catalog default instead of writing the invalid manifest value.
		expect(MODEL_COLLECTIONS_BY_PROVIDER_ID.gemini.provider.defaultModelId).toBe("gemma-4-26b")
		expect(normalized.actModeApiModelId).toBe("gemini-3.5-flash")
	})

	it("restores a previously committed DeepSeek selection before falling back to SDK default", () => {
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })
		vi.mocked(store.readSelection).mockReturnValue({
			providerId,
			modelId: "deepseek-v4-pro",
			modelInfo: { name: "DeepSeek V4 Pro", contextWindow: 1_000_000, supportsPromptCache: true },
		})

		const normalized = normalizeProviderSwitchModel(
			store,
			{ actModeApiProvider: "anthropic", actModeApiModelId: "claude-sonnet-4-5-20250929" },
			{ actModeApiProvider: "deepseek", actModeApiModelId: undefined },
		)

		expect(normalized.actModeApiModelId).toBe("deepseek-v4-pro")
	})

	it("keeps an already valid DeepSeek model id", () => {
		const providerId = parseProviderId("deepseek")
		const store = makeStore({ providerId })

		const normalized = normalizeProviderSwitchModel(
			store,
			{ actModeApiProvider: "anthropic", actModeApiModelId: "deepseek-v4-flash" },
			{ actModeApiProvider: "deepseek", actModeApiModelId: undefined },
		)

		expect(normalized.actModeApiModelId).toBe("deepseek-v4-flash")
		expect(store.readSelection).not.toHaveBeenCalled()
	})

	it("does not change model id when switching to a provider the SDK does not know", () => {
		// A custom/unregistered provider has no SDK catalog to resolve against, so
		// the generic model-id slot is left untouched.
		const providerId = parseProviderId("my-custom-provider")
		const store = makeStore({ providerId })

		const normalized = normalizeProviderSwitchModel(
			store,
			{ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-flash" },
			{ actModeApiProvider: "my-custom-provider" as never },
		)

		expect(normalized).toEqual({ actModeApiProvider: "my-custom-provider" })
		expect(store.readSelection).not.toHaveBeenCalled()
	})

	it("normalizes plan mode independently", () => {
		const providerId = parseProviderId("deepseek")
		const defaultModelId = MODEL_COLLECTIONS_BY_PROVIDER_ID.deepseek.provider.defaultModelId
		const store = makeStore({ providerId })

		const normalized = normalizeProviderSwitchModel(
			store,
			{ planModeApiProvider: "anthropic", planModeApiModelId: "claude-sonnet-4-5-20250929" },
			{ planModeApiProvider: "deepseek", planModeApiModelId: undefined },
		)

		expect(normalized.planModeApiProvider).toBe("deepseek")
		expect(normalized.planModeApiModelId).toBe(defaultModelId)
	})
})
