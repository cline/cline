import { ApiFormat, ResolveModelInfoResponse } from "@shared/proto/cline/models"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useNormalizedApiConfiguration } from "./useNormalizedApiConfiguration"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		resolveModelInfo: vi.fn(),
		resolveProviderModels: vi.fn(),
	},
}))

const mockUseExtensionState = vi.mocked(useExtensionState)
const mockResolveModelInfo = vi.mocked(ModelsServiceClient.resolveModelInfo)
const mockResolveProviderModels = vi.mocked(ModelsServiceClient.resolveProviderModels)

function setApiConfiguration(apiConfiguration: Record<string, unknown>) {
	mockUseExtensionState.mockReturnValue({ apiConfiguration } as ReturnType<typeof useExtensionState>)
}

function modelInfoResponse(providerId: string, modelId: string, contextWindow = 1_000_000) {
	return ResolveModelInfoResponse.create({
		providerId,
		modelId,
		source: "sdk-known-models",
		modelInfo: {
			name: "DeepSeek V4 Pro",
			contextWindow,
			maxTokens: 384_000,
			supportsPromptCache: true,
			supportsReasoning: true,
			apiFormat: ApiFormat.OPENAI_CHAT,
		},
	})
}

function deepSeekResponse(modelId: string, contextWindow = 1_000_000) {
	return modelInfoResponse("deepseek", modelId, contextWindow)
}

describe("useNormalizedApiConfiguration", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setApiConfiguration({})
	})

	it("resolves DeepSeek model info through the pure RPC", async () => {
		setApiConfiguration({ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" })
		mockResolveModelInfo.mockResolvedValue(deepSeekResponse("deepseek-v4-pro"))

		const { result } = renderHook(() => useNormalizedApiConfiguration("act"))

		expect(result.current.selectedModelInfo.contextWindow).toBeUndefined()
		await waitFor(() => expect(result.current.selectedModelInfo.contextWindow).toBe(1_000_000))
		expect(result.current.selectedModelId).toBe("deepseek-v4-pro")
		expect(mockResolveModelInfo).toHaveBeenCalledWith({ providerId: "deepseek", modelId: "deepseek-v4-pro" })
		expect(mockResolveProviderModels).not.toHaveBeenCalled()
	})

	it("does not flash 128K before the DeepSeek RPC resolves", () => {
		setApiConfiguration({ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" })
		mockResolveModelInfo.mockReturnValue(new Promise(() => undefined))

		const { result } = renderHook(() => useNormalizedApiConfiguration("act"))

		expect(result.current.selectedModelInfo.contextWindow).toBeUndefined()
		expect(mockResolveProviderModels).not.toHaveBeenCalled()
	})

	it("uses the SDK default model info when model id is empty", async () => {
		setApiConfiguration({ actModeApiProvider: "deepseek", actModeApiModelId: "" })
		mockResolveModelInfo.mockResolvedValue(deepSeekResponse("deepseek-v4-flash"))

		const { result } = renderHook(() => useNormalizedApiConfiguration("act"))

		await waitFor(() => expect(result.current.selectedModelId).toBe("deepseek-v4-flash"))
		expect(result.current.selectedModelInfo.contextWindow).toBe(1_000_000)
		expect(mockResolveModelInfo).toHaveBeenCalledWith({ providerId: "deepseek", modelId: undefined })
		expect(mockResolveProviderModels).not.toHaveBeenCalled()
	})

	it("uses Cline-specific model fields instead of stale generic or OpenRouter fields", async () => {
		setApiConfiguration({
			actModeApiProvider: "cline",
			actModeApiModelId: "openai/gpt-5.4",
			actModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
			actModeClineModelId: "anthropic/claude-sonnet-4.6",
		})
		mockResolveModelInfo.mockResolvedValue(modelInfoResponse("cline", "anthropic/claude-sonnet-4.6"))

		const { result } = renderHook(() => useNormalizedApiConfiguration("act"))

		await waitFor(() => expect(result.current.selectedModelId).toBe("anthropic/claude-sonnet-4.6"))
		expect(mockResolveModelInfo).toHaveBeenCalledWith({ providerId: "cline", modelId: "anthropic/claude-sonnet-4.6" })
	})

	it("asks the backend for the Cline default when no Cline-specific model is selected", async () => {
		setApiConfiguration({
			actModeApiProvider: "cline",
			actModeApiModelId: "openai/gpt-5.4",
			actModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
		})
		mockResolveModelInfo.mockResolvedValue(modelInfoResponse("cline", "anthropic/claude-sonnet-4.6"))

		const { result } = renderHook(() => useNormalizedApiConfiguration("act"))

		await waitFor(() => expect(result.current.selectedModelId).toBe("anthropic/claude-sonnet-4.6"))
		expect(mockResolveModelInfo).toHaveBeenCalledWith({ providerId: "cline", modelId: undefined })
	})

	it("falls back to legacy normalization for non-migrated providers", () => {
		setApiConfiguration({ actModeApiProvider: "anthropic", actModeApiModelId: "claude-sonnet-4-5-20250929" })

		const { result } = renderHook(() => useNormalizedApiConfiguration("act"))

		expect(result.current.selectedProvider).toBe("anthropic")
		expect(result.current.selectedModelId).toBe("claude-sonnet-4-5-20250929")
		expect(mockResolveModelInfo).not.toHaveBeenCalled()
		expect(mockResolveProviderModels).not.toHaveBeenCalled()
	})

	it("ignores stale DeepSeek responses after provider/model changes", async () => {
		let resolveFirst: (value: ResolveModelInfoResponse) => void = () => undefined
		mockResolveModelInfo
			.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
			.mockResolvedValueOnce(deepSeekResponse("deepseek-v4-flash", 1_000_000))
		setApiConfiguration({ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-pro" })

		const { result, rerender } = renderHook(() => useNormalizedApiConfiguration("act"))

		setApiConfiguration({ actModeApiProvider: "deepseek", actModeApiModelId: "deepseek-v4-flash" })
		rerender()
		await act(async () => {
			resolveFirst(deepSeekResponse("deepseek-v4-pro", 500_000))
		})

		await waitFor(() => expect(result.current.selectedModelId).toBe("deepseek-v4-flash"))
		expect(result.current.selectedModelInfo.contextWindow).toBe(1_000_000)
	})
})
