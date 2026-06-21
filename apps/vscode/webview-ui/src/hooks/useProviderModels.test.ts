import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useProviderModels } from "./useProviderModels"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		resolveProviderModels: vi.fn(),
	},
}))

const startProviderModelsRequest = vi.fn()
const applyProviderModelsResponse = vi.fn()

function mockExtensionState(remoteConfigSettings: Record<string, unknown> = {}) {
	vi.mocked(useExtensionState).mockReturnValue({
		remoteConfigSettings,
		providerModelsByProvider: {},
		startProviderModelsRequest,
		applyProviderModelsResponse,
	} as unknown as ReturnType<typeof useExtensionState>)
}

describe("useProviderModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(ModelsServiceClient.resolveProviderModels).mockImplementation(async (request) => ({
			providerId: request.providerId,
			requestId: request.requestId,
			configFingerprint: "fingerprint",
			fetchedAt: Date.now(),
			ok: true,
			models: {},
			defaultModelId: "",
			source: "host-adapter",
		}))
		mockExtensionState()
	})

	it("refreshes provider models when remote config settings change", async () => {
		const { rerender } = renderHook(() => useProviderModels("cline"))

		await waitFor(() => expect(ModelsServiceClient.resolveProviderModels).toHaveBeenCalledTimes(1))

		mockExtensionState({
			remoteProviderModelSettings: {
				cline: {
					models: [{ id: "allowed-model" }],
				},
			},
		})
		rerender()

		await waitFor(() => expect(ModelsServiceClient.resolveProviderModels).toHaveBeenCalledTimes(2))
		expect(ModelsServiceClient.resolveProviderModels).toHaveBeenLastCalledWith(
			expect.objectContaining({ providerId: "cline", forceRefresh: true }),
		)
	})
})
