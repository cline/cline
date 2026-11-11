import { ApiFormat } from "@shared/proto/cline/models"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useProviderModelSelection } from "./useProviderModelSelection"

describe("useProviderModelSelection", () => {
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

	it("prefers live catalog model info over a stale committed snapshot when no overrides exist", () => {
		const commitSelection = vi.fn(async () => undefined)
		const liveModelInfo = {
			name: "DeepSeek V3 (refreshed)",
			contextWindow: 163_840,
			maxTokens: 32_768,
			supportsPromptCache: false,
			supportsReasoning: true,
		}
		const { result } = renderHook(() =>
			useProviderModelSelection("baseten", "act", {
				models: { "deepseek-ai/DeepSeek-V3": liveModelInfo },
				config: {
					providerId: "baseten",
					headers: {},
					apiKeyLength: 8,
					hasAccessToken: false,
					hasRefreshToken: false,
					actSelection: {
						providerId: "baseten",
						modelId: "deepseek-ai/DeepSeek-V3",
						modelInfo: {
							name: "DeepSeek V3 (stale)",
							contextWindow: 64_000,
							maxTokens: 8_192,
							supportsPromptCache: false,
							tiers: [],
						},
					},
				},
				commitSelection,
			}),
		)

		expect(result.current.selectedModelInfo).toEqual(liveModelInfo)
	})
})
