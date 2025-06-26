// npx vitest src/components/ui/hooks/__tests__/useSelectedModel.spec.ts

import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { Mock } from "vitest"

import { ProviderSettings, ModelInfo } from "@roo-code/types"

import { useSelectedModel } from "../useSelectedModel"
import { useRouterModels } from "../useRouterModels"
import { useOpenRouterModelProviders } from "../useOpenRouterModelProviders"

vi.mock("../useRouterModels")
vi.mock("../useOpenRouterModelProviders")

const mockUseRouterModels = useRouterModels as Mock<typeof useRouterModels>
const mockUseOpenRouterModelProviders = useOpenRouterModelProviders as Mock<typeof useOpenRouterModelProviders>

const createWrapper = () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	})
	return ({ children }: { children: React.ReactNode }) =>
		React.createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useSelectedModel", () => {
	describe("OpenRouter provider merging", () => {
		it("should merge base model info with specific provider info when both exist", () => {
			const baseModelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsImages: false,
				supportsPromptCache: false,
			}

			const specificProviderInfo: ModelInfo = {
				maxTokens: 8192, // Different value that should override
				contextWindow: 16384, // Different value that should override
				supportsImages: true, // Different value that should override
				supportsPromptCache: true, // Different value that should override
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"test-model": baseModelInfo,
					},
					requesty: {},
					glama: {},
					unbound: {},
					litellm: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {
					"test-provider": specificProviderInfo,
				},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
				openRouterSpecificProvider: "test-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("test-model")
			expect(result.current.info).toEqual({
				maxTokens: 8192, // From specific provider (overrides base)
				contextWindow: 16384, // From specific provider (overrides base)
				supportsImages: true, // From specific provider (overrides base)
				supportsPromptCache: true, // From specific provider (overrides base)
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
			})
		})

		it("should use only specific provider info when base model info is missing", () => {
			const specificProviderInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					requesty: {},
					glama: {},
					unbound: {},
					litellm: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {
					"test-provider": specificProviderInfo,
				},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
				openRouterSpecificProvider: "test-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("test-model")
			expect(result.current.info).toEqual(specificProviderInfo)
		})

		it("should demonstrate the merging behavior validates the comment about missing fields", () => {
			const baseModelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsImages: false,
				supportsPromptCache: false,
				supportsComputerUse: true,
				cacheWritesPrice: 0.1,
				cacheReadsPrice: 0.01,
			}

			const specificProviderInfo: Partial<ModelInfo> = {
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
				maxTokens: 8192, // Override this one
				supportsImages: true, // Override this one
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"test-model": baseModelInfo,
					},
					requesty: {},
					glama: {},
					unbound: {},
					litellm: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: { "test-provider": specificProviderInfo as ModelInfo },
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
				openRouterSpecificProvider: "test-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("test-model")
			expect(result.current.info).toEqual({
				// Fields from base model that provider doesn't have
				contextWindow: 8192, // From base (provider doesn't override)
				supportsPromptCache: false, // From base (provider doesn't override)
				supportsComputerUse: true, // From base (provider doesn't have)
				cacheWritesPrice: 0.1, // From base (provider doesn't have)
				cacheReadsPrice: 0.01, // From base (provider doesn't have)

				// Fields overridden by provider
				maxTokens: 8192, // From provider (overrides base)
				supportsImages: true, // From provider (overrides base)

				// Fields only in provider
				inputPrice: 0.001, // From provider (base doesn't have)
				outputPrice: 0.002, // From provider (base doesn't have)
				description: "Provider-specific description", // From provider (base doesn't have)
			})
		})

		it("should use base model info when no specific provider is configured", () => {
			const baseModelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsImages: false,
				supportsPromptCache: false,
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: { "test-model": baseModelInfo },
					requesty: {},
					glama: {},
					unbound: {},
					litellm: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("test-model")
			expect(result.current.info).toEqual(baseModelInfo)
		})

		it("should fall back to default when both base and specific provider info are missing", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"anthropic/claude-sonnet-4": {
							// Default model
							maxTokens: 8192,
							contextWindow: 200_000,
							supportsImages: true,
							supportsComputerUse: true,
							supportsPromptCache: true,
							inputPrice: 3.0,
							outputPrice: 15.0,
							cacheWritesPrice: 3.75,
							cacheReadsPrice: 0.3,
						},
					},
					requesty: {},
					glama: {},
					unbound: {},
					litellm: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "non-existent-model",
				openRouterSpecificProvider: "non-existent-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("non-existent-model")
			expect(result.current.info).toBeUndefined()
		})
	})

	describe("loading and error states", () => {
		it("should return loading state when router models are loading", () => {
			mockUseRouterModels.mockReturnValue({
				data: undefined,
				isLoading: true,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			expect(result.current.isLoading).toBe(true)
		})

		it("should return loading state when open router model providers are loading", () => {
			mockUseRouterModels.mockReturnValue({
				data: { openrouter: {}, requesty: {}, glama: {}, unbound: {}, litellm: {} },
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: undefined,
				isLoading: true,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			expect(result.current.isLoading).toBe(true)
		})

		it("should return error state when either hook has an error", () => {
			mockUseRouterModels.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: true,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			expect(result.current.isError).toBe(true)
		})
	})

	describe("default behavior", () => {
		it("should return anthropic default when no configuration is provided", () => {
			mockUseRouterModels.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			expect(result.current.provider).toBe("anthropic")
			expect(result.current.id).toBe("claude-sonnet-4-20250514")
			expect(result.current.info).toBeUndefined()
		})
	})

	describe("claude-code provider", () => {
		it("should return claude-code model with supportsImages disabled", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					requesty: {},
					glama: {},
					unbound: {},
					litellm: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "claude-code",
				apiModelId: "claude-sonnet-4-20250514",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("claude-code")
			expect(result.current.id).toBe("claude-sonnet-4-20250514")
			expect(result.current.info).toBeDefined()
			expect(result.current.info?.supportsImages).toBe(false)
			expect(result.current.info?.supportsPromptCache).toBe(true) // Claude Code now supports prompt cache
			// Verify it inherits other properties from anthropic models
			expect(result.current.info?.maxTokens).toBe(64_000)
			expect(result.current.info?.contextWindow).toBe(200_000)
			expect(result.current.info?.supportsComputerUse).toBe(true)
		})

		it("should use default claude-code model when no modelId is specified", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					requesty: {},
					glama: {},
					unbound: {},
					litellm: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "claude-code",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("claude-code")
			expect(result.current.id).toBe("claude-sonnet-4-20250514") // Default model
			expect(result.current.info).toBeDefined()
			expect(result.current.info?.supportsImages).toBe(false)
		})
	})
})
