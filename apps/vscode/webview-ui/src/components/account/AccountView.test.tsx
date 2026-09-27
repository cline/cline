import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ClineAuthProvider, useClineAuth } from "@/context/ClineAuthContext"
import AccountView from "./AccountView"

vi.mock("./CreditBalance", () => ({
	CreditBalance: ({ balance }: { balance: number | null }) => (
		<div data-testid="credit-balance">{balance ?? "unavailable"}</div>
	),
}))

const mocks = vi.hoisted(() => ({
	setUserOrganization: vi.fn(),
	getUserCredits: vi.fn(),
	getOrganizationCredits: vi.fn(),
	getUserOrganizations: vi.fn(),
	subscribeToAuthStatusUpdate: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ remoteConfigSettings: {}, environment: "production", cloudSessionsEnabled: false }),
}))

vi.mock("@/hooks/useClinePassPromo", () => ({
	useClinePassPromo: () => ({ isClinePassEnabled: false }),
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		setUserOrganization: mocks.setUserOrganization,
		getUserCredits: mocks.getUserCredits,
		getOrganizationCredits: mocks.getOrganizationCredits,
		getUserOrganizations: mocks.getUserOrganizations,
		subscribeToAuthStatusUpdate: mocks.subscribeToAuthStatusUpdate,
	},
	StateServiceClient: { updateSettings: vi.fn() },
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, ...props }: any) => <a {...props}>{children}</a>,
	VSCodeButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
	VSCodeDivider: () => <hr />,
	VSCodeTag: ({ children }: any) => <span>{children}</span>,
	VSCodeDropdown: ({ currentValue, disabled, onChange, children }: any) => (
		<select aria-label="Account" disabled={disabled} onChange={onChange} value={currentValue}>
			{children}
		</select>
	),
	VSCodeOption: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

const user = { uid: "user-1", email: "user@example.com", displayName: "User", appBaseUrl: "https://app.cline.bot" }
const organization = { active: true, memberId: "member-1", name: "Organization", organizationId: "org-1", roles: ["member"] }

function ConnectedAccountView({ visible = true }: { visible?: boolean }) {
	const { clineUser, organizations, activeOrganization } = useClineAuth()
	return visible ? (
		<AccountView
			activeOrganization={activeOrganization}
			clineUser={clineUser}
			onDone={vi.fn()}
			organizations={organizations}
		/>
	) : null
}

async function renderAccount() {
	const view = render(
		<ClineAuthProvider>
			<ConnectedAccountView />
		</ClineAuthProvider>,
	)
	await waitFor(() => expect((screen.getByLabelText("Account") as HTMLSelectElement).value).toBe(organization.organizationId))
	return view
}

describe("AccountView organization switch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.getUserCredits.mockResolvedValue({ balance: { currentBalance: 1 }, usageTransactions: [], paymentTransactions: [] })
		mocks.getOrganizationCredits.mockResolvedValue({ balance: { currentBalance: 2 }, usageTransactions: [] })
		mocks.getUserOrganizations.mockResolvedValue({ organizations: [organization] })
		mocks.subscribeToAuthStatusUpdate.mockImplementation((_request, callbacks) => {
			callbacks.onResponse({ user })
			return vi.fn()
		})
	})

	it("disables the dropdown until the server answers, then reverts and reports a refused switch", async () => {
		const switching = deferred<Record<string, never>>()
		mocks.setUserOrganization.mockReturnValue(switching.promise)
		await renderAccount()
		const dropdown = screen.getByLabelText("Account") as HTMLSelectElement
		await waitFor(() => expect(dropdown.disabled).toBe(false))

		fireEvent.change(dropdown, { target: { value: user.uid } })

		expect(mocks.setUserOrganization).toHaveBeenCalledWith({ organizationId: undefined })
		expect(dropdown.value).toBe(user.uid)
		expect(dropdown.disabled).toBe(true)
		expect(screen.getByLabelText("Switching account")).toBeInTheDocument()

		await act(async () => {
			switching.reject(new Error("Cloud session cleanup is still pending."))
		})

		expect(dropdown.value).toBe(organization.organizationId)
		expect(dropdown.disabled).toBe(false)
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Could not confirm account switch: Cloud session cleanup is still pending.",
		)
	})

	it("loads the new account's credits only after the server has switched", async () => {
		const switching = deferred<Record<string, never>>()
		mocks.setUserOrganization.mockReturnValue(switching.promise)
		await renderAccount()
		const dropdown = screen.getByLabelText("Account") as HTMLSelectElement
		await waitFor(() => expect(dropdown.disabled).toBe(false))
		mocks.getUserCredits.mockClear()

		fireEvent.change(dropdown, { target: { value: user.uid } })
		expect(mocks.getUserCredits).not.toHaveBeenCalled()
		expect(screen.getByTestId("credit-balance")).toHaveTextContent("unavailable")

		await act(async () => {
			mocks.getUserOrganizations.mockResolvedValue({ organizations: [{ ...organization, active: false }] })
			switching.resolve({})
		})

		await waitFor(() => expect(mocks.getUserCredits).toHaveBeenCalledOnce())
		expect(dropdown.value).toBe(user.uid)
		expect(dropdown.disabled).toBe(false)
		expect(screen.queryByRole("alert")).toBeNull()
	})

	it("keeps a switch pending across Account navigation and uses confirmed state after a partial failure", async () => {
		const switching = deferred<Record<string, never>>()
		mocks.setUserOrganization.mockReturnValue(switching.promise)
		const view = await renderAccount()
		fireEvent.change(screen.getByLabelText("Account"), { target: { value: user.uid } })
		view.rerender(
			<ClineAuthProvider>
				<ConnectedAccountView visible={false} />
			</ClineAuthProvider>,
		)
		view.rerender(
			<ClineAuthProvider>
				<ConnectedAccountView />
			</ClineAuthProvider>,
		)
		expect(screen.getByLabelText("Account")).toBeDisabled()
		await act(async () => {
			mocks.getUserOrganizations.mockResolvedValue({ organizations: [{ ...organization, active: false }] })
			switching.reject(new Error("Remote config failed after switching"))
		})
		expect(screen.getByLabelText("Account")).toHaveValue(user.uid)
		expect(screen.getByLabelText("Account")).not.toBeDisabled()
		expect(mocks.setUserOrganization).toHaveBeenCalledOnce()
	})

	it("ignores old-account credits that arrive after a switch", async () => {
		const oldCredits = deferred<{ balance: { currentBalance: number }; usageTransactions: [] }>()
		mocks.getOrganizationCredits.mockReturnValue(oldCredits.promise)
		mocks.setUserOrganization.mockImplementation(async () => {
			mocks.getUserOrganizations.mockResolvedValue({ organizations: [{ ...organization, active: false }] })
		})
		await renderAccount()
		fireEvent.change(screen.getByLabelText("Account"), { target: { value: user.uid } })
		await waitFor(() => expect(screen.getByTestId("credit-balance")).toHaveTextContent("1"))
		await act(async () => {
			oldCredits.resolve({ balance: { currentBalance: 999 }, usageTransactions: [] })
		})
		expect(screen.getByTestId("credit-balance")).toHaveTextContent("1")
	})

	it("keeps the last account and reports a failed confirmation read", async () => {
		await renderAccount()
		mocks.setUserOrganization.mockResolvedValue({})
		mocks.getUserOrganizations.mockRejectedValue(new Error("offline"))
		fireEvent.change(screen.getByLabelText("Account"), { target: { value: user.uid } })
		await waitFor(() => expect(screen.getByLabelText("Account")).not.toBeDisabled())
		expect(screen.getByLabelText("Account")).toHaveValue(organization.organizationId)
		expect(screen.getByRole("alert")).toHaveTextContent("Could not confirm the active account")
	})
})
