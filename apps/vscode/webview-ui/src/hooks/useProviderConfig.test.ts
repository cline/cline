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

	it("drops a stale read response that resolves after a newer write was issued", async () => {
		// Repro: settings mounts (slow read in flight), the user immediately
		// edits a field (write issued). The stale pre-write read must not
		// apply — it would roll the UI back while the write is pending.
		let resolveRead: (value: ProviderConfigResponse) => void = () => {}
		vi.mocked(ModelsServiceClient.readProviderConfig).mockReturnValue(
			new Promise<ProviderConfigResponse>((resolve) => {
				resolveRead = resolve
			}),
		)
		let resolveWrite: (value: ProviderConfigResponse) => void = () => {}
		vi.mocked(ModelsServiceClient.writeProviderConfig).mockReturnValue(
			new Promise<ProviderConfigResponse>((resolve) => {
				resolveWrite = resolve
			}),
		)

		const { result } = renderHook(() => useProviderConfig("deepseek"))

		let writePromise: Promise<unknown> = Promise.resolve()
		act(() => {
			writePromise = result.current.write({ baseUrl: "https://new.example/v1" })
		})

		// The stale mount read resolves while the write is in flight.
		await act(async () => {
			resolveRead(config("deepseek", "https://old.example/v1"))
		})
		expect(result.current.config).toBeUndefined()

		await act(async () => {
			resolveWrite(config("deepseek", "https://new.example/v1"))
			await writePromise
		})
		expect(result.current.config?.baseUrl).toBe("https://new.example/v1")
	})

	it("re-reads after a failed write so config converges instead of staying stale", async () => {
		// Writes can fail host-side (e.g. base URL rejected by schema
		// validation while a partial URL is typed). The failed write is the
		// latest request, so no response will ever apply for it — the hook
		// must re-read or config could remain stale (or undefined) forever.
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config("deepseek", "https://saved.example/v1"))
		vi.mocked(ModelsServiceClient.writeProviderConfig).mockRejectedValue(new Error("invalid url"))

		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config?.baseUrl).toBe("https://saved.example/v1"))

		await act(async () => {
			await expect(result.current.write({ baseUrl: "h" })).rejects.toThrow("invalid url")
		})

		await waitFor(() => expect(ModelsServiceClient.readProviderConfig).toHaveBeenCalledTimes(2))
		expect(result.current.config?.baseUrl).toBe("https://saved.example/v1")
	})

	it("skips the failure recovery read when a newer write is already in flight", async () => {
		// If an older write fails while a newer write is pending, a recovery
		// read would take over the latest request seq, discard the newer
		// write's response, and could pin a pre-write snapshot host-side.
		// The newer write's own response (or failure recovery) supersedes.
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config("deepseek", "https://saved.example/v1"))
		let rejectFirstWrite: (error: unknown) => void = () => {}
		let resolveSecondWrite: (value: ProviderConfigResponse) => void = () => {}
		vi.mocked(ModelsServiceClient.writeProviderConfig)
			.mockReturnValueOnce(
				new Promise<ProviderConfigResponse>((_, reject) => {
					rejectFirstWrite = reject
				}),
			)
			.mockReturnValueOnce(
				new Promise<ProviderConfigResponse>((resolve) => {
					resolveSecondWrite = resolve
				}),
			)

		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.config).toBeDefined())

		let firstWrite: Promise<unknown> = Promise.resolve()
		let secondWrite: Promise<unknown> = Promise.resolve()
		act(() => {
			firstWrite = result.current.write({ baseUrl: "h" })
			secondWrite = result.current.write({ baseUrl: "https://new.example/v1" })
		})

		await act(async () => {
			rejectFirstWrite(new Error("invalid url"))
			await expect(firstWrite).rejects.toThrow("invalid url")
		})
		// No recovery read: the mount read must remain the only one.
		expect(ModelsServiceClient.readProviderConfig).toHaveBeenCalledTimes(1)

		await act(async () => {
			resolveSecondWrite(config("deepseek", "https://new.example/v1"))
			await secondWrite
		})
		expect(result.current.config?.baseUrl).toBe("https://new.example/v1")
	})

	it("exposes nothing while a switched-to provider's config is still loading", async () => {
		// Settings components stay mounted across a provider switch, so the
		// hook would otherwise keep showing provider A's state (and let the
		// user edit against it) until provider B's read lands.
		let resolveSecondRead: (value: ProviderConfigResponse) => void = () => {}
		vi.mocked(ModelsServiceClient.readProviderConfig)
			.mockResolvedValueOnce(ProviderConfigResponse.create({ ...config("deepseek"), reasoningEffort: "high" }))
			.mockReturnValueOnce(
				new Promise<ProviderConfigResponse>((resolve) => {
					resolveSecondRead = resolve
				}),
			)

		const { result, rerender } = renderHook(({ providerId }) => useProviderConfig(providerId), {
			initialProps: { providerId: "deepseek" as const },
		})
		await waitFor(() => expect(result.current.reasoningEffort).toBe("high"))

		rerender({ providerId: "groq" as never })

		expect(result.current.config).toBeUndefined()
		expect(result.current.reasoningEffort).toBeNull()

		await act(async () => {
			resolveSecondRead(config("groq"))
		})
		expect(result.current.config?.providerId).toBe("groq")
		expect(result.current.reasoningEffort).toBe("default")
	})

	it("keeps a config whose host id differs from the requested id (aliases, normalization)", async () => {
		// The host folds "openai-compatible" to "openai" and lowercases ids;
		// scoping must key on the id the hook asked for, or such a provider's
		// config would never be exposed.
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config("openai"))

		const { result } = renderHook(() => useProviderConfig("openai-compatible" as never))

		await waitFor(() => expect(result.current.config?.providerId).toBe("openai"))
		expect(result.current.reasoningEffort).toBe("default")
	})

	it("reports the reasoning effort as unknown while a reasoning write is pending", async () => {
		// A selector still showing the pre-write value would treat a pick of
		// that value as no change and never save it.
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())
		let resolveWrite: (value: ProviderConfigResponse) => void = () => {}
		vi.mocked(ModelsServiceClient.writeProviderConfig).mockReturnValue(
			new Promise<ProviderConfigResponse>((resolve) => {
				resolveWrite = resolve
			}),
		)

		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.reasoningEffort).toBe("default"))

		let writePromise: Promise<unknown> = Promise.resolve()
		act(() => {
			writePromise = result.current.write({ reasoning: { enabled: false, effort: "none" } })
		})
		expect(result.current.reasoningEffort).toBeNull()

		await act(async () => {
			resolveWrite(ProviderConfigResponse.create({ ...config(), reasoningEffort: "none" }))
			await writePromise
		})
		expect(result.current.reasoningEffort).toBe("none")
	})

	it("keeps the reasoning effort known while an unrelated write is pending", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(
			ProviderConfigResponse.create({ ...config(), reasoningEffort: "low" }),
		)
		vi.mocked(ModelsServiceClient.writeProviderConfig).mockReturnValue(new Promise<ProviderConfigResponse>(() => {}))

		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.reasoningEffort).toBe("low"))

		act(() => {
			void result.current.write({ apiKey: "new-key" })
		})
		expect(result.current.reasoningEffort).toBe("low")
	})

	it("clears the pending reasoning state when the write fails", async () => {
		vi.mocked(ModelsServiceClient.readProviderConfig).mockResolvedValue(config())
		vi.mocked(ModelsServiceClient.writeProviderConfig).mockRejectedValue(new Error("write failed"))

		const { result } = renderHook(() => useProviderConfig("deepseek"))
		await waitFor(() => expect(result.current.reasoningEffort).toBe("default"))

		await act(async () => {
			await result.current.write({ clearReasoning: true }).catch(() => {})
		})
		await waitFor(() => expect(result.current.reasoningEffort).toBe("default"))
	})
})
