import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { useProviderListings } from "./useProviderListings"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		listProviders: vi.fn(),
	},
}))

function mockExtensionState(remoteConfigSettings: Record<string, unknown> = {}) {
	vi.mocked(useExtensionState).mockReturnValue({
		remoteConfigSettings,
	} as ReturnType<typeof useExtensionState>)
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve
		reject = innerReject
	})
	return { promise, resolve, reject }
}

describe("useProviderListings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(ModelsServiceClient.listProviders).mockResolvedValue({ providers: [] } as any)
		mockExtensionState()
	})

	it("refreshes provider listings when remote config settings change", async () => {
		const { rerender } = renderHook(() => useProviderListings())

		await waitFor(() => expect(ModelsServiceClient.listProviders).toHaveBeenCalledTimes(1))

		mockExtensionState({ remoteConfiguredProviders: ["openai-compatible"] })
		rerender()

		await waitFor(() => expect(ModelsServiceClient.listProviders).toHaveBeenCalledTimes(2))
	})

	it("ignores stale provider listing responses after remote config changes", async () => {
		const first = deferred<any>()
		const second = deferred<any>()
		vi.mocked(ModelsServiceClient.listProviders).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

		const { result, rerender } = renderHook(() => useProviderListings())

		await waitFor(() => expect(ModelsServiceClient.listProviders).toHaveBeenCalledTimes(1))
		mockExtensionState({ remoteConfiguredProviders: ["openai-compatible"] })
		rerender()
		await waitFor(() => expect(ModelsServiceClient.listProviders).toHaveBeenCalledTimes(2))

		second.resolve({ providers: [{ id: "openai-compatible", name: "OpenAI Compatible" }] })
		await waitFor(() => expect(result.current.providers.map((provider) => provider.id)).toEqual(["openai-compatible"]))

		first.resolve({ providers: [{ id: "stale", name: "Stale" }] })
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(result.current.providers.map((provider) => provider.id)).toEqual(["openai-compatible"])
	})
})
