import { ApiFormat, type ProviderConfigResponse } from "@shared/proto/cline/models"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useProviderModelSelection } from "./useProviderModelSelection"

describe("useProviderModelSelection", () => {
	it("uses the fresh catalog entry when the committed snapshot is a $0 placeholder", () => {
		const commitSelection = vi.fn(async () => undefined)
		const models = {
			"gpt-5.6-sol": {
				name: "GPT-5.6 Sol",
				contextWindow: 1_050_000,
				maxTokens: 128_000,
				supportsPromptCache: true,
				inputPrice: 5,
				outputPrice: 30,
			},
		}
		// Placeholder snapshot: a generic provider's live-only model absent from
		// the static catalog resolves to $0/no-pricing.
		const config = {
			actSelection: {
				modelId: "gpt-5.6-sol",
				modelInfo: {
					name: "GPT-5.6 Sol",
					contextWindow: 128_000,
					maxTokens: -1,
					inputPrice: 0,
					outputPrice: 0,
					tiers: [],
				},
			},
		} as unknown as ProviderConfigResponse

		const { result } = renderHook(() => useProviderModelSelection("pioneer", "act", { models, config, commitSelection }))

		expect(result.current.selectedModel.modelInfo.inputPrice).toBe(5)
		expect(result.current.selectedModel.modelInfo.outputPrice).toBe(30)
		expect(result.current.selectedModel.modelInfo.contextWindow).toBe(1_050_000)
	})

	it("keeps a committed snapshot that has pricing (does not override with the fresh entry)", () => {
		const commitSelection = vi.fn(async () => undefined)
		// User/override snapshot with real pricing; the fresh entry differs.
		const models = { "some-model": { name: "Fresh", contextWindow: 111, inputPrice: 9, outputPrice: 9, maxTokens: 1 } }
		const config = {
			actSelection: {
				modelId: "some-model",
				modelInfo: {
					name: "Committed",
					contextWindow: 200_000,
					maxTokens: 8_192,
					inputPrice: 2,
					outputPrice: 8,
					tiers: [],
				},
			},
		} as unknown as ProviderConfigResponse

		const { result } = renderHook(() => useProviderModelSelection("provider", "act", { models, config, commitSelection }))

		// Committed pricing wins — the fresh entry must not clobber it.
		expect(result.current.selectedModel.modelInfo.inputPrice).toBe(2)
		expect(result.current.selectedModel.modelInfo.contextWindow).toBe(200_000)
	})

	it("falls back to the committed snapshot when the model is absent from the catalog", () => {
		const commitSelection = vi.fn(async () => undefined)
		const config = {
			actSelection: {
				modelId: "dropped-model",
				modelInfo: {
					name: "Dropped",
					contextWindow: 200_000,
					maxTokens: 8_192,
					inputPrice: 2,
					outputPrice: 8,
					tiers: [],
				},
			},
		} as unknown as ProviderConfigResponse

		const { result } = renderHook(() => useProviderModelSelection("pioneer", "act", { models: {}, config, commitSelection }))

		expect(result.current.selectedModel.modelId).toBe("dropped-model")
		expect(result.current.selectedModel.modelInfo.inputPrice).toBe(2)
	})

	it("does not turn custom fallback model info into persisted overrides", async () => {
		const commitSelection = vi.fn(async () => undefined)
		const customModelInfo = {
			name: "Custom model",
			contextWindow: 128_000,
			maxTokens: -1,
			inputPrice: 0,
			outputPrice: 0,
			temperature: 0,
		}
		const { result } = renderHook(() =>
			useProviderModelSelection("custom-provider", "act", {
				models: {},
				commitSelection,
				customModelInfo: () => customModelInfo,
			}),
		)

		await act(async () => {
			await result.current.commitModelSelection({ modelId: "custom-model", modelInfo: customModelInfo })
		})

		expect(commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-provider",
			modelId: "custom-model",
		})
	})

	it("forwards only explicitly supplied overrides", async () => {
		const commitSelection = vi.fn(async () => undefined)
		const { result } = renderHook(() =>
			useProviderModelSelection("custom-provider", "act", {
				models: {},
				commitSelection,
			}),
		)

		await act(async () => {
			await result.current.commitModelSelection({
				modelId: "custom-model",
				modelInfo: { contextWindow: 128_000, maxTokens: -1, temperature: -1 },
				overrides: {
					apiFormat: ApiFormat.OPENAI_RESPONSES,
					capabilities: ["tools", "streaming"],
					temperature: 0.2,
				},
			})
		})

		expect(commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-provider",
			modelId: "custom-model",
			overrides: {
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				capabilities: ["tools", "streaming"],
				temperature: 0.2,
			},
		})
	})
})
