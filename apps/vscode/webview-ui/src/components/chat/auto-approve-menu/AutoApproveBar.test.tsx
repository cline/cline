import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AutoApproveBar, { CLOUD_AUTO_APPROVE_TOOLTIP } from "./AutoApproveBar"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, children, disabled }: { checked: boolean; children: React.ReactNode; disabled: boolean }) => (
		<label>
			<input checked={checked} disabled={disabled} readOnly type="checkbox" />
			{children}
		</label>
	),
}))

const mocks = vi.hoisted(() => ({
	autoApprovalSettings: {
		version: 1,
		enabled: true,
		favorites: [],
		maxRequests: 20,
		actions: {
			readFiles: true,
			editFiles: false,
			executeSafeCommands: false,
			executeAllCommands: false,
			useBrowser: false,
			useMcp: false,
		},
		enableNotifications: false,
	},
	updateAutoApproveSettings: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ autoApprovalSettings: mocks.autoApprovalSettings }),
}))

vi.mock("./AutoApproveSettingsAPI", () => ({
	updateAutoApproveSettings: mocks.updateAutoApproveSettings,
}))

describe("AutoApproveBar", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
	})

	it("shows forced read-only cloud approvals without changing local settings", async () => {
		const localSettings = structuredClone(mocks.autoApprovalSettings)
		const user = userEvent.setup()
		const { rerender } = render(<AutoApproveBar cloudAutoApprove />)
		const trigger = screen.getByLabelText("Open auto-approve settings")

		expect(trigger).toHaveTextContent("Auto-approve:Read, Edit, Commands, Web Fetch, MCP")
		await user.hover(trigger)
		expect(await screen.findByText(CLOUD_AUTO_APPROVE_TOOLTIP)).toBeInTheDocument()

		fireEvent.click(trigger)
		expect(
			screen.getByText("Cloud sessions always auto-approve these actions. Your local settings are unchanged."),
		).toBeInTheDocument()

		const checkboxes = screen.getAllByRole("checkbox")
		expect(checkboxes).toHaveLength(5)
		for (const checkbox of checkboxes) {
			expect(checkbox).toBeChecked()
			expect(checkbox).toBeDisabled()
			fireEvent.click(checkbox)
		}
		expect(mocks.updateAutoApproveSettings).not.toHaveBeenCalled()
		expect(mocks.autoApprovalSettings).toEqual(localSettings)

		fireEvent.click(screen.getByLabelText("Close auto-approve settings"))
		rerender(<AutoApproveBar />)
		expect(screen.getByLabelText("Open auto-approve settings")).toHaveTextContent("Auto-approve:Read")
		expect(screen.queryByText(CLOUD_AUTO_APPROVE_TOOLTIP)).not.toBeInTheDocument()
		expect(mocks.autoApprovalSettings).toEqual(localSettings)
	})
})
