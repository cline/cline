import type { AuthState, UserOrganizationsResponse } from "@shared/proto/cline/account"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClineAuthProvider, useClineAuth } from "./ClineAuthContext"

type AuthStatusCallbacks = {
	onResponse: (response: AuthState) => void
}

const grpcMocks = vi.hoisted(() => ({
	getUserOrganizations: vi.fn(),
	subscribeToAuthStatusUpdate: vi.fn(),
	setUserOrganization: vi.fn(),
	authStatusCallbacks: undefined as AuthStatusCallbacks | undefined,
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getUserOrganizations: grpcMocks.getUserOrganizations,
		subscribeToAuthStatusUpdate: grpcMocks.subscribeToAuthStatusUpdate,
		setUserOrganization: grpcMocks.setUserOrganization,
	},
}))

function createDeferred<T>() {
	let resolve: (value: T) => void = () => {}
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

function AuthStateProbe() {
	const { clineUser, organizations, switchOrganization, accountSwitch, accountSwitchError } = useClineAuth()
	return (
		<>
			<div data-testid="user-state">{clineUser?.uid ?? "signed-out"}</div>
			<button onClick={() => void switchOrganization("org-next")} type="button">
				Switch
			</button>
			<div data-testid="switch-state">{accountSwitch ? (accountSwitch.slow ? "slow" : "pending") : "settled"}</div>
			<div data-testid="switch-error">{accountSwitchError ?? "none"}</div>
			<div data-testid="organizations-state">
				{organizations?.map((organization) => organization.organizationId).join(",") ?? "none"}
			</div>
		</>
	)
}

describe("ClineAuthProvider", () => {
	afterEach(() => vi.useRealTimers())
	beforeEach(() => {
		vi.clearAllMocks()
		grpcMocks.authStatusCallbacks = undefined
		grpcMocks.subscribeToAuthStatusUpdate.mockImplementation((_request, callbacks: AuthStatusCallbacks) => {
			grpcMocks.authStatusCallbacks = callbacks
			return vi.fn()
		})
	})

	it("does not restore organizations when an in-flight request resolves after sign-out", async () => {
		const organizationsRequest = createDeferred<UserOrganizationsResponse>()
		grpcMocks.getUserOrganizations.mockReturnValue(organizationsRequest.promise)

		render(
			<ClineAuthProvider>
				<AuthStateProbe />
			</ClineAuthProvider>,
		)

		act(() => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-1" } })
		})
		expect(grpcMocks.getUserOrganizations).toHaveBeenCalledTimes(1)

		act(() => {
			grpcMocks.authStatusCallbacks?.onResponse({})
		})

		await act(async () => {
			organizationsRequest.resolve({
				organizations: [
					{ organizationId: "stale-org", active: true, memberId: "member-1", name: "Stale Org", roles: [] },
				],
			})
			await organizationsRequest.promise
		})

		expect(screen.getByTestId("user-state")).toHaveTextContent("signed-out")
		expect(screen.getByTestId("organizations-state")).toHaveTextContent("none")
	})

	it("keeps a slow switch owned and ignores its completion after sign-out", async () => {
		vi.useFakeTimers()
		const switching = createDeferred<Record<string, never>>()
		grpcMocks.setUserOrganization.mockReturnValue(switching.promise)
		grpcMocks.getUserOrganizations.mockResolvedValue({ organizations: [] })
		render(
			<ClineAuthProvider>
				<AuthStateProbe />
			</ClineAuthProvider>,
		)
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-1" } })
		})
		fireEvent.click(screen.getByText("Switch"))
		fireEvent.click(screen.getByText("Switch"))
		expect(grpcMocks.setUserOrganization).toHaveBeenCalledOnce()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000)
		})
		expect(screen.getByTestId("switch-state")).toHaveTextContent("slow")
		act(() => {
			grpcMocks.authStatusCallbacks?.onResponse({})
		})
		grpcMocks.getUserOrganizations.mockClear()
		await act(async () => {
			switching.resolve({})
		})
		expect(grpcMocks.getUserOrganizations).not.toHaveBeenCalled()
		expect(screen.getByTestId("switch-state")).toHaveTextContent("settled")
		expect(screen.getByTestId("user-state")).toHaveTextContent("signed-out")
	})

	it("gives a replacement user a separate switch owner", async () => {
		const first = createDeferred<Record<string, never>>()
		const second = createDeferred<Record<string, never>>()
		grpcMocks.setUserOrganization.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
		grpcMocks.getUserOrganizations.mockResolvedValue({ organizations: [] })
		render(
			<ClineAuthProvider>
				<AuthStateProbe />
			</ClineAuthProvider>,
		)
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-a" } })
		})
		fireEvent.click(screen.getByText("Switch"))
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-b" } })
		})
		expect(screen.getByTestId("switch-state")).toHaveTextContent("settled")
		fireEvent.click(screen.getByText("Switch"))
		await act(async () => {
			first.resolve({})
		})
		expect(screen.getByTestId("switch-state")).toHaveTextContent("pending")
		await act(async () => {
			second.resolve({})
		})
		expect(grpcMocks.setUserOrganization).toHaveBeenCalledTimes(2)
		expect(screen.getByTestId("switch-state")).toHaveTextContent("settled")
	})

	it("confirms a switch whose confirmation read is overtaken by the switch's own auth-status update", async () => {
		const confirmation = createDeferred<UserOrganizationsResponse>()
		const activeNext = {
			organizations: [{ organizationId: "org-next", active: true, memberId: "m", name: "Next", roles: [] }],
		}
		grpcMocks.getUserOrganizations
			.mockResolvedValueOnce({ organizations: [] })
			.mockReturnValueOnce(confirmation.promise)
			.mockResolvedValue(activeNext)
		grpcMocks.setUserOrganization.mockResolvedValue({})
		let result: Promise<boolean> | undefined
		function SwitchProbe() {
			const { switchOrganization } = useClineAuth()
			return (
				<button
					onClick={() => {
						result = switchOrganization("org-next")
					}}
					type="button">
					Switch next
				</button>
			)
		}
		render(
			<ClineAuthProvider>
				<SwitchProbe />
			</ClineAuthProvider>,
		)
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-1" } })
		})
		await act(async () => {
			fireEvent.click(screen.getByText("Switch next"))
		})
		// The extension's auth refresh after the PUT starts a newer read before
		// the switch's confirmation read has answered.
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-1" } })
		})
		await act(async () => {
			confirmation.resolve(activeNext)
		})
		expect(await result).toBe(true)
	})

	it("retracts an unconfirmed switch error once a later refresh shows the requested account", async () => {
		const activeOld = {
			organizations: [{ organizationId: "org-old", active: true, memberId: "m", name: "Old", roles: [] }],
		}
		const activeNext = {
			organizations: [{ organizationId: "org-next", active: true, memberId: "m", name: "Next", roles: [] }],
		}
		grpcMocks.getUserOrganizations.mockResolvedValue(activeOld)
		grpcMocks.setUserOrganization.mockRejectedValue(new Error("Account switch was not confirmed within 10 seconds"))
		render(
			<ClineAuthProvider>
				<AuthStateProbe />
			</ClineAuthProvider>,
		)
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-1" } })
		})
		await act(async () => {
			fireEvent.click(screen.getByText("Switch"))
		})
		expect(screen.getByTestId("switch-error")).toHaveTextContent("not confirmed")

		// An unrelated refresh while the server is still on the old account keeps the error.
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-1" } })
		})
		expect(screen.getByTestId("switch-error")).toHaveTextContent("not confirmed")

		// The late PUT commits and the extension's auth refresh lands on the new account.
		grpcMocks.getUserOrganizations.mockResolvedValue(activeNext)
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-1" } })
		})
		expect(screen.getByTestId("switch-error")).toHaveTextContent("none")
		expect(screen.getByTestId("organizations-state")).toHaveTextContent("org-next")
	})

	it("does not report a background profile read as a failed account switch", async () => {
		grpcMocks.getUserOrganizations.mockRejectedValue(new Error("offline"))
		render(
			<ClineAuthProvider>
				<AuthStateProbe />
			</ClineAuthProvider>,
		)
		await act(async () => {
			grpcMocks.authStatusCallbacks?.onResponse({ user: { uid: "user-a" } })
		})
		expect(screen.getByTestId("switch-error")).toHaveTextContent("none")
	})
})
