import type { UserOrganization } from "@shared/proto/index.cline"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RemoteConfigToggle } from "./RemoteConfigToggle"

const mocks = vi.hoisted(() => ({
	updateSettings: vi.fn(),
	state: {
		optOutOfRemoteConfig: false,
		remoteConfigAvailable: false,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mocks.state,
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: { updateSettings: mocks.updateSettings },
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, children, onChange }: any) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
}))

function organization(roles = ["admin"]): UserOrganization {
	return {
		active: true,
		memberId: "member-1",
		name: "Organization",
		organizationId: "org-1",
		roles,
	}
}

describe("RemoteConfigToggle", () => {
	beforeEach(() => {
		mocks.updateSettings.mockReset().mockResolvedValue(undefined)
		mocks.state.optOutOfRemoteConfig = false
		mocks.state.remoteConfigAvailable = false
	})

	it("hides the toggle when the active organization has no remote config", () => {
		render(<RemoteConfigToggle activeOrganization={organization()} />)

		expect(screen.queryByRole("checkbox")).toBeNull()
	})

	it("shows the toggle for an admin when remote config is available", () => {
		mocks.state.remoteConfigAvailable = true
		render(<RemoteConfigToggle activeOrganization={organization()} />)

		expect(screen.getByRole("checkbox", { name: "Opt out of remote config" })).toBeDefined()
	})

	it("keeps the toggle available while opted out so the org can opt back in", () => {
		mocks.state.remoteConfigAvailable = true
		mocks.state.optOutOfRemoteConfig = true
		render(<RemoteConfigToggle activeOrganization={organization()} />)

		expect(screen.getByRole("checkbox")).toBeChecked()
	})

	it("hides the toggle for members who cannot opt out", () => {
		mocks.state.remoteConfigAvailable = true
		render(<RemoteConfigToggle activeOrganization={organization(["member"])} />)

		expect(screen.queryByRole("checkbox")).toBeNull()
	})

	it("updates the opt-out setting", () => {
		mocks.state.remoteConfigAvailable = true
		render(<RemoteConfigToggle activeOrganization={organization()} />)

		fireEvent.click(screen.getByRole("checkbox"))

		expect(mocks.updateSettings).toHaveBeenCalledOnce()
		expect(mocks.updateSettings.mock.calls[0][0].optOutOfRemoteConfig).toBe(true)
	})
})
