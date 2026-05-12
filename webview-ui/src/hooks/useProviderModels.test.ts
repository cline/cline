import type { ProviderModelsResponse } from "@shared/proto/cline/models"
import { act, renderHook, waitFor } from "@testing-library/react"
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

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function response(requestId: string): ProviderModelsResponse {
	return {
		providerId: "deepseek",
		requestId,
		configFingerprint: `fingerprint-${requestId}`,
		fetchedAt: 1,
		ok: true,
		models: {},
		defaultModelId: "deepseek-v4-flash",
		source: "sdk-dynamic",
	}
}

function installFakeProviderModelsContext() {
	const latestRequestIds: Record<string, string> = {}
	const applied: ProviderModelsResponse[] = []
	const startProviderModelsRequest = vi.fn((providerId: string, requestId: string) => {
		latestRequestIds[providerId] = requestId
	})
	const applyProviderModelsResponse = vi.fn((providerResponse: ProviderModelsResponse) => {
		if (latestRequestIds[providerResponse.providerId] === providerResponse.requestId) {
			applied.push(providerResponse)
		}
	})

	vi.mocked(useExtensionState).mockReturnValue({
		providerModelsByProvider: {},
		startProviderModelsRequest,
		applyProviderModelsResponse,
	} as ReturnType<typeof useExtensionState>)

	return { applied, startProviderModelsRequest, applyProviderModelsResponse }
}

describe("useProviderModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValueOnce("req-1")
			.mockReturnValueOnce("req-2")
			.mockReturnValueOnce("req-3")
	})

	it("applies a matching requestId response", async () => {
		const context = installFakeProviderModelsContext()
		vi.mocked(ModelsServiceClient.resolveProviderModels).mockResolvedValue(response("req-1"))

		renderHook(() => useProviderModels("deepseek"))

		await waitFor(() => expect(context.applied).toHaveLength(1))
		expect(context.startProviderModelsRequest).toHaveBeenCalledWith("deepseek", "req-1")
		expect(ModelsServiceClient.resolveProviderModels).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: "deepseek", forceRefresh: true, requestId: "req-1" }),
		)
		expect(context.applied[0].requestId).toBe("req-1")
	})

	it("drops a mismatched requestId response through the apply rule", async () => {
		const context = installFakeProviderModelsContext()
		vi.mocked(ModelsServiceClient.resolveProviderModels).mockResolvedValue(response("stale-req"))

		renderHook(() => useProviderModels("deepseek"))

		await waitFor(() => expect(context.applyProviderModelsResponse).toHaveBeenCalledTimes(1))
		expect(context.applied).toHaveLength(0)
	})

	it("only applies the second of two rapid refresh responses", async () => {
		const context = installFakeProviderModelsContext()
		const deferredByRequestId = new Map<string, ReturnType<typeof deferred<ProviderModelsResponse>>>()
		vi.mocked(ModelsServiceClient.resolveProviderModels).mockImplementation((request) => {
			const pending = deferred<ProviderModelsResponse>()
			deferredByRequestId.set(request.requestId ?? "", pending)
			return pending.promise
		})

		const { result } = renderHook(() => useProviderModels("deepseek"))
		await waitFor(() => expect(ModelsServiceClient.resolveProviderModels).toHaveBeenCalledTimes(1))
		act(() => {
			void result.current.refresh()
		})
		await waitFor(() => expect(ModelsServiceClient.resolveProviderModels).toHaveBeenCalledTimes(2))
		const latestRequestId = context.startProviderModelsRequest.mock.calls.at(-1)?.[1]
		expect(latestRequestId).toBeDefined()

		deferredByRequestId.get(latestRequestId ?? "")?.resolve(response(latestRequestId ?? ""))
		await waitFor(() => expect(context.applied.map((item) => item.requestId)).toEqual([latestRequestId]))

		for (const [requestId, pending] of deferredByRequestId) {
			if (requestId !== latestRequestId) {
				pending.resolve(response(requestId))
			}
		}
		await waitFor(() => expect(context.applyProviderModelsResponse).toHaveBeenCalledTimes(deferredByRequestId.size))
		expect(context.applied.map((item) => item.requestId)).toEqual([latestRequestId])
	})
})
