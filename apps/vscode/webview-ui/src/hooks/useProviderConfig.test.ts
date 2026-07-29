import { StringRequest } from "@shared/proto/cline/common"
import { ApiFormat, ModelOverrides, ProviderConfigResponse } from "@shared/proto/cline/models"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelsServiceClient } from "@/services/grpc-client"
import { fromProtobufProviderModelOverrides, toProtobufProviderModelOverrides, useProviderConfig } from "./useProviderConfig"

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		readProviderConfig: vi.fn(),
		writeProviderConfig: vi.fn(),
		commitModelSelection: vi.fn(),
	},
}))

function config(providerId = "deepseek", baseUrl = "https://api.deepseek.com/v1") {
	return ProviderConfigResponse.create({
		providerId,
		baseUrl,
		headers: {},
		apiKeyLength: 0,
		hasAccessToken: false,
		hasRefreshToken: false,
	})
}

describe("useProviderConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reads provider config on mount", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())

		const { result } = renderHook(() => useProviderConfig("deepseek"))

		await waitFor(() => expect(result.current.config?.providerId).toBe("deepseek"))
		expect(ModelsServiceClient.readProviderConfig).toHaveBeenCalledWith(StringRequest.create({ value: "deepseek" }))
	})

	it("write sends a provider config patch and stores returned config", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())
		vi.mocked(ModelsServiceClient.writeProviderConfig).mockResolvedValue(config("deepseek", "https://custom.example/v1"))
		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config).toBeDefined())

		await act(async () => {
			await result.current.write({ baseUrl: "https://custom.example/v1", apiKey: "SECRET_SENTINEL" })
		})

		expect(ModelsServiceClient.writeProviderConfig).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "deepseek",
				patch: expect.objectContaining({ baseUrl: "https://custom.example/v1", apiKey: "SECRET_SENTINEL" }),
			}),
		)
		expect(result.current.config?.baseUrl).toBe("https://custom.example/v1")
	})

	it("commitSelection sends model settings and refreshes config", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig)
			.mockResolvedValueOnce(config())
			.mockResolvedValueOnce(
				ProviderConfigResponse.create({
					providerId: "deepseek",
					headers: {},
					apiKeyLength: 0,
					hasAccessToken: false,
					hasRefreshToken: false,
					actSelection: {
						providerId: "deepseek",
						modelId: "deepseek-v4-flash",
						modelInfo: {
							name: "DeepSeek V4 Flash",
							supportsPromptCache: true,
							apiFormat: ApiFormat.OPENAI_CHAT,
							tiers: [],
						},
						overrides: ModelOverrides.create({
							apiFormat: ApiFormat.OPENAI_RESPONSES,
							capabilities: ["tools", "streaming"],
							temperature: 0.4,
						}),
					},
				}),
			)
		vi.mocked(ModelsServiceClient.commitModelSelection).mockResolvedValue({})
		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config).toBeDefined())

		await act(async () => {
			await result.current.commitSelection("act", {
				providerId: "deepseek",
				modelId: "deepseek-v4-flash",
				overrides: { name: "DeepSeek V4 Flash", capabilities: ["prompt-cache"] },
			})
		})

		expect(ModelsServiceClient.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "deepseek",
				mode: "act",
				modelId: "deepseek-v4-flash",
				overrides: expect.objectContaining({
					name: "DeepSeek V4 Flash",
					capabilities: ["prompt-cache"],
				}),
			}),
		)
		expect(ModelsServiceClient.readProviderConfig).toHaveBeenCalledTimes(2)
		expect(result.current.config?.actSelection?.modelId).toBe("deepseek-v4-flash")
		expect(fromProtobufProviderModelOverrides(result.current.config?.actSelection?.overrides)).toEqual({
			apiFormat: ApiFormat.OPENAI_RESPONSES,
			capabilities: ["tools", "streaming"],
			temperature: 0.4,
		})
	})

	it("converts every domain override field explicitly and preserves an empty override message", () => {
		const overrides = {
			name: "Custom",
			maxTokens: 8_192,
			contextWindow: 128_000,
			maxInputTokens: 120_000,
			capabilities: ["tools", "streaming"],
			supportsVision: false,
			supportsAttachments: true,
			supportsReasoning: false,
			inputPrice: 1,
			outputPrice: 2,
			cacheReadsPrice: 3,
			cacheWritesPrice: 4,
			temperature: 0.2,
			apiFormat: ApiFormat.OPENAI_RESPONSES,
			isR1FormatRequired: false,
		}

		expect(fromProtobufProviderModelOverrides(toProtobufProviderModelOverrides(overrides))).toEqual(overrides)
		expect(toProtobufProviderModelOverrides({})).toEqual(ModelOverrides.create({}))
	})

	it("sends an explicit empty override message so the host can clear stored overrides", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())
		vi.mocked(ModelsServiceClient.commitModelSelection).mockResolvedValue({})
		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config).toBeDefined())

		await act(async () => {
			await result.current.commitSelection("act", {
				providerId: "deepseek",
				modelId: "custom-model",
				overrides: {},
			})
		})

		expect(ModelsServiceClient.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				modelId: "custom-model",
				overrides: ModelOverrides.create({}),
			}),
		)
	})

	it("commitSelection rejects mismatched provider ids without calling RPC", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())
		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config).toBeDefined())

		await expect(
			result.current.commitSelection("act", {
				providerId: "openrouter",
				modelId: "deepseek-v4-flash",
			}),
		).rejects.toThrow("selection providerId openrouter does not match hook providerId deepseek")
		expect(ModelsServiceClient.commitModelSelection).not.toHaveBeenCalled()
	})
})
