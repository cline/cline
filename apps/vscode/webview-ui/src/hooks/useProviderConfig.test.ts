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

	it("waits for an in-flight provider write before reading the same provider", async () => {
		let resolveWrite: ((response: ProviderConfigResponse) => void) | undefined
		vi.mocked(ModelsServiceClient.readProviderConfig)
			.mockResolvedValueOnce(config())
			.mockResolvedValueOnce(config("deepseek", "https://custom.example/v1"))
		vi.mocked(ModelsServiceClient.writeProviderConfig).mockImplementation(
			() =>
				new Promise<ProviderConfigResponse>((resolve) => {
					resolveWrite = resolve
				}),
		)
		const first = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(first.result.current.config).toBeDefined())

		let writePromise: Promise<ProviderConfigResponse> | undefined
		act(() => {
			writePromise = first.result.current.write({ baseUrl: "https://custom.example/v1" })
		})
		await waitFor(() => expect(ModelsServiceClient.writeProviderConfig).toHaveBeenCalledTimes(1))

		const second = renderHook(() => useProviderConfig("deepseek"))
		await Promise.resolve()
		expect(ModelsServiceClient.readProviderConfig).toHaveBeenCalledTimes(1)

		await act(async () => {
			resolveWrite?.(config("deepseek", "https://custom.example/v1"))
			await writePromise
		})

		await waitFor(() => expect(second.result.current.config?.baseUrl).toBe("https://custom.example/v1"))
		expect(ModelsServiceClient.readProviderConfig).toHaveBeenCalledTimes(2)
	})

	it("serializes writes and ignores stale write responses", async () => {
		let resolveFirstWrite: ((response: ProviderConfigResponse) => void) | undefined
		let resolveSecondWrite: ((response: ProviderConfigResponse) => void) | undefined
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())
		vi.mocked(ModelsServiceClient.writeProviderConfig)
			.mockImplementationOnce(
				() =>
					new Promise<ProviderConfigResponse>((resolve) => {
						resolveFirstWrite = resolve
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<ProviderConfigResponse>((resolve) => {
						resolveSecondWrite = resolve
					}),
			)
		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config).toBeDefined())

		let firstWrite: Promise<ProviderConfigResponse> | undefined
		let secondWrite: Promise<ProviderConfigResponse> | undefined
		act(() => {
			firstWrite = result.current.write({ baseUrl: "https://first.example/v1" })
			secondWrite = result.current.write({ baseUrl: "https://second.example/v1" })
		})

		await waitFor(() => expect(ModelsServiceClient.writeProviderConfig).toHaveBeenCalledTimes(1))
		expect(vi.mocked(ModelsServiceClient.writeProviderConfig).mock.calls[0]?.[0].patch?.baseUrl).toBe(
			"https://first.example/v1",
		)

		await act(async () => {
			resolveFirstWrite?.(config("deepseek", "https://first.example/v1"))
			await firstWrite
		})

		await waitFor(() => expect(ModelsServiceClient.writeProviderConfig).toHaveBeenCalledTimes(2))
		expect(result.current.config?.baseUrl).not.toBe("https://first.example/v1")
		expect(vi.mocked(ModelsServiceClient.writeProviderConfig).mock.calls[1]?.[0].patch?.baseUrl).toBe(
			"https://second.example/v1",
		)

		await act(async () => {
			resolveSecondWrite?.(config("deepseek", "https://second.example/v1"))
			await secondWrite
		})

		expect(result.current.config?.baseUrl).toBe("https://second.example/v1")
	})

	it("commitSelection sends the full selection envelope and refreshes config", async () => {
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
