import type { RemoteConfigSettingsResponse } from "@shared/proto/cline/remote_config"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { RemoteConfigServiceClient } from "@/services/grpc-client"
import useRemoteConfigSettings from "./useRemoteConfigSettings"

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: vi.fn() }))
vi.mock("@/services/grpc-client", () => ({
	RemoteConfigServiceClient: {
		getRemoteConfigSettings: vi.fn(),
		toggleRemoteConfigSetting: vi.fn(),
	},
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

const useExtensionStateMock = vi.mocked(useExtensionState)
const getSettingsMock = vi.mocked(RemoteConfigServiceClient.getRemoteConfigSettings)
const toggleSettingMock = vi.mocked(RemoteConfigServiceClient.toggleRemoteConfigSetting)

describe("useRemoteConfigSettings", () => {
	let revision = 0

	beforeEach(() => {
		revision = 0
		useExtensionStateMock.mockImplementation(
			() => ({ remoteConfigRevision: revision }) as ReturnType<typeof useExtensionState>,
		)
		getSettingsMock.mockReset()
		toggleSettingMock.mockReset()
	})

	it("reports loading and then the authoritative settings", async () => {
		const request = deferred<RemoteConfigSettingsResponse>()
		getSettingsMock.mockReturnValue(request.promise as never)
		const { result } = renderHook(() => useRemoteConfigSettings(true))

		expect(result.current).toEqual({ settings: [], isLoading: true, error: undefined })

		request.resolve({
			settings: [{ type: 0, name: "Security", content: "Policy", enabled: true, locked: true }],
		})
		await waitFor(() => expect(result.current.isLoading).toBe(false))
		expect(result.current.settings[0]).toMatchObject({ type: "rule", name: "Security", locked: true })
	})

	it("refetches when the extension publishes a new remote-config revision", async () => {
		getSettingsMock.mockResolvedValueOnce({ settings: [] } as never).mockResolvedValueOnce({
			settings: [{ type: 1, name: "Release", content: "Steps", enabled: true, locked: false }],
		} as never)
		const { result, rerender } = renderHook(() => useRemoteConfigSettings(true))
		await waitFor(() => expect(getSettingsMock).toHaveBeenCalledTimes(1))

		revision = 1
		rerender()

		await waitFor(() => expect(getSettingsMock).toHaveBeenCalledTimes(2))
		await waitFor(() => expect(result.current.settings[0]?.name).toBe("Release"))
	})

	it("retains stale settings and reports an error when refresh fails", async () => {
		getSettingsMock.mockResolvedValueOnce({
			settings: [{ type: 2, name: "Review", content: "Skill", enabled: true, locked: false }],
		} as never)
		const { result, rerender } = renderHook(() => useRemoteConfigSettings(true))
		await waitFor(() => expect(result.current.settings[0]?.name).toBe("Review"))

		getSettingsMock.mockRejectedValueOnce(new Error("transport failed"))
		revision = 1
		rerender()

		await waitFor(() => expect(result.current.error).toBe("transport failed"))
		expect(result.current.settings[0]?.name).toBe("Review")
	})

	it("updates from the authoritative toggle response", async () => {
		getSettingsMock.mockResolvedValue({
			settings: [{ type: 0, name: "Optional", content: "Policy", enabled: true, locked: false }],
		} as never)
		toggleSettingMock.mockResolvedValue({
			type: 0,
			name: "Optional",
			content: "Policy",
			enabled: false,
			locked: false,
		} as never)
		const { result } = renderHook(() => useRemoteConfigSettings(true))
		await waitFor(() => expect(result.current.settings[0]?.name).toBe("Optional"))

		act(() => result.current.settings[0].toggle(false))

		await waitFor(() => expect(result.current.settings[0].enabled).toBe(false))
		expect(toggleSettingMock).toHaveBeenCalledWith({ type: 0, name: "Optional", enabled: false })
	})

	it("surfaces toggle failures and retains the authoritative previous value", async () => {
		getSettingsMock.mockResolvedValue({
			settings: [{ type: 0, name: "Optional", content: "Policy", enabled: true, locked: false }],
		} as never)
		toggleSettingMock.mockRejectedValue(new Error("toggle failed"))
		const { result } = renderHook(() => useRemoteConfigSettings(true))
		await waitFor(() => expect(result.current.settings[0]?.name).toBe("Optional"))

		act(() => result.current.settings[0].toggle(false))

		await waitFor(() => expect(result.current.error).toBe("toggle failed"))
		expect(result.current.settings[0].enabled).toBe(true)
	})

	it("ignores a response after the modal becomes hidden", async () => {
		const request = deferred<RemoteConfigSettingsResponse>()
		getSettingsMock.mockReturnValue(request.promise as never)
		const { result, rerender } = renderHook(({ visible }) => useRemoteConfigSettings(visible), {
			initialProps: { visible: true },
		})

		rerender({ visible: false })
		await act(async () => {
			request.resolve({ settings: [{ type: 0, name: "Late", content: "", enabled: true, locked: false }] })
			await request.promise
		})

		expect(result.current.settings).toEqual([])
	})
})
