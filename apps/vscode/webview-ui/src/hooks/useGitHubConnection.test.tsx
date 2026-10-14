import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useGitHubConnection } from "./useGitHubConnection"

const mocks = vi.hoisted(() => ({
	activeOrganization: undefined as { organizationId: string } | undefined,
	clineUser: { uid: "user-a" },
	accountSwitch: null as object | null,
	getGitHubConnection: vi.fn(),
}))

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({
		activeOrganization: mocks.activeOrganization,
		clineUser: mocks.clineUser,
		accountSwitch: mocks.accountSwitch,
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	CloudServiceClient: { getGitHubConnection: mocks.getGitHubConnection },
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

const connected = { signedIn: true, connected: true, connectUrl: "", repositories: [{ id: 1 }] }
const disconnected = { signedIn: true, connected: false, connectUrl: "https://connect", repositories: [] }

describe("useGitHubConnection", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.activeOrganization = { organizationId: "org-a" }
		mocks.clineUser = { uid: "user-a" }
		mocks.accountSwitch = null
	})

	it("re-reads the connection for the new active account and ignores the old account's late answer", async () => {
		const first = deferred<typeof connected>()
		const second = deferred<typeof disconnected>()
		mocks.getGitHubConnection.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
		const { result, rerender } = renderHook(() => useGitHubConnection(true))
		expect(mocks.getGitHubConnection).toHaveBeenCalledTimes(1)

		mocks.activeOrganization = { organizationId: "org-b" }
		rerender()
		await waitFor(() => expect(mocks.getGitHubConnection).toHaveBeenCalledTimes(2))
		expect(result.current.connection).toBeUndefined()

		await act(async () => {
			first.resolve(connected)
		})
		expect(result.current.connection).toBeUndefined()

		await act(async () => {
			second.resolve(disconnected)
		})
		expect(result.current.connection).toEqual(disconnected)
		expect(result.current.loading).toBe(false)
	})

	it("discards a disabled request even when the same account is enabled again", async () => {
		const first = deferred<typeof connected>()
		mocks.getGitHubConnection.mockReturnValueOnce(first.promise).mockResolvedValueOnce(disconnected)
		const { result, rerender } = renderHook(({ enabled }) => useGitHubConnection(enabled), {
			initialProps: { enabled: true },
		})
		rerender({ enabled: false })
		await act(async () => {
			first.resolve(connected)
		})
		expect(result.current.connection).toBeUndefined()
		rerender({ enabled: true })
		await waitFor(() => expect(result.current.connection).toEqual(disconnected))
		expect(mocks.getGitHubConnection).toHaveBeenCalledTimes(2)
	})

	it("does not reuse the previous user's personal GitHub connection", async () => {
		mocks.activeOrganization = undefined
		mocks.getGitHubConnection.mockResolvedValueOnce(connected).mockResolvedValueOnce(disconnected)
		const { result, rerender } = renderHook(() => useGitHubConnection(true))
		await waitFor(() => expect(result.current.connection).toEqual(connected))
		mocks.clineUser = { uid: "user-b" }
		rerender()
		expect(result.current.connection).toBeUndefined()
		await waitFor(() => expect(result.current.connection).toEqual(disconnected))
	})

	it("hides repositories during a switch and refetches even if the switch is refused", async () => {
		mocks.getGitHubConnection.mockResolvedValueOnce(connected).mockResolvedValueOnce(disconnected)
		const { result, rerender } = renderHook(() => useGitHubConnection(true))
		await waitFor(() => expect(result.current.connection).toEqual(connected))
		mocks.accountSwitch = {}
		rerender()
		expect(result.current.connection).toBeUndefined()
		expect(mocks.getGitHubConnection).toHaveBeenCalledTimes(1)
		mocks.accountSwitch = null
		rerender()
		await waitFor(() => expect(result.current.connection).toEqual(disconnected))
	})
})
