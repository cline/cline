import { StringRequest } from "@shared/proto/cline/common"
import { ApiFormat, ProviderConfigResponse } from "@shared/proto/cline/models"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useProviderConfig } from "./useProviderConfig"

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
		hasApiKey: false,
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

	it("commitSelection sends the full selection envelope and refreshes config", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig)
			.mockResolvedValueOnce(config())
			.mockResolvedValueOnce(
				ProviderConfigResponse.create({
					providerId: "deepseek",
					headers: {},
					hasApiKey: false,
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
				modelInfo: { name: "DeepSeek V4 Flash", supportsPromptCache: true, apiFormat: ApiFormat.OPENAI_CHAT },
			})
		})

		expect(ModelsServiceClient.commitModelSelection).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "deepseek",
				mode: "act",
				modelId: "deepseek-v4-flash",
				modelInfo: expect.objectContaining({
					name: "DeepSeek V4 Flash",
					supportsPromptCache: true,
					apiFormat: ApiFormat.OPENAI_CHAT,
				}),
			}),
		)
		expect(ModelsServiceClient.readProviderConfig).toHaveBeenCalledTimes(2)
		expect(result.current.config?.actSelection?.modelId).toBe("deepseek-v4-flash")
	})

	it("commitSelection rejects mismatched provider ids without calling RPC", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())
		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config).toBeDefined())

		await expect(
			result.current.commitSelection("act", {
				providerId: "openrouter",
				modelId: "deepseek-v4-flash",
				modelInfo: { supportsPromptCache: true },
			}),
		).rejects.toThrow("selection providerId openrouter does not match hook providerId deepseek")
		expect(ModelsServiceClient.commitModelSelection).not.toHaveBeenCalled()
	})
})
