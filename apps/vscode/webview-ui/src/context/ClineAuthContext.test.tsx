import { act, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClineAuthProvider, useClineAuth } from "./ClineAuthContext"

const mocks = vi.hoisted(() => ({
	getUserOrganizations: vi.fn(),
	subscribeToAuthStatusUpdate: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getUserOrganizations: mocks.getUserOrganizations,
		subscribeToAuthStatusUpdate: mocks.subscribeToAuthStatusUpdate,
	},
}))

type AuthStatusCallbacks = {
	onResponse: (response: { user?: { uid: string } }) => Promise<void>
}

const Consumer = (): ReactNode => {
	const { activeOrganization } = useClineAuth()
	return <div>{activeOrganization?.name ?? "Personal"}</div>
}

describe("ClineAuthProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("refreshes the active organization on auth updates for the same user", async () => {
		let callbacks: AuthStatusCallbacks | undefined
		mocks.subscribeToAuthStatusUpdate.mockImplementation((_request, nextCallbacks) => {
			callbacks = nextCallbacks
			return vi.fn()
		})
		mocks.getUserOrganizations
			.mockResolvedValueOnce({
				organizations: [
					{ active: true, memberId: "member-a", name: "Org A", organizationId: "org-a", roles: [] },
					{ active: false, memberId: "member-b", name: "Org B", organizationId: "org-b", roles: [] },
				],
			})
			.mockResolvedValueOnce({
				organizations: [
					{ active: false, memberId: "member-a", name: "Org A", organizationId: "org-a", roles: [] },
					{ active: true, memberId: "member-b", name: "Org B", organizationId: "org-b", roles: [] },
				],
			})

		render(
			<ClineAuthProvider>
				<Consumer />
			</ClineAuthProvider>,
		)

		await act(async () => {
			await callbacks?.onResponse({ user: { uid: "user-1" } })
		})
		await waitFor(() => expect(screen.getByText("Org A")).toBeInTheDocument())

		await act(async () => {
			await callbacks?.onResponse({ user: { uid: "user-1" } })
		})

		await waitFor(() => expect(screen.getByText("Org B")).toBeInTheDocument())
		expect(mocks.getUserOrganizations).toHaveBeenCalledTimes(2)
	})
})
