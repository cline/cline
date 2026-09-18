import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CloudTaskBadge } from "./CloudTaskBadge"

const mocks = vi.hoisted(() => ({
	openCloudSessionDashboard: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	CloudServiceClient: {
		openCloudSessionDashboard: mocks.openCloudSessionDashboard,
	},
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe("CloudTaskBadge", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.openCloudSessionDashboard.mockResolvedValue({})
	})

	it("does not open a client-only provisioning id in the dashboard", () => {
		render(
			<CloudTaskBadge
				cloudTask={{
					sessionId: "cloud-provisioning-1",
					status: "provisioning",
					dashboardUrl: "",
				}}
			/>,
		)

		const badge = screen.getByRole("button")
		expect(badge).toBeDisabled()
		fireEvent.click(badge)
		expect(mocks.openCloudSessionDashboard).not.toHaveBeenCalled()
	})

	it("opens a persisted cloud session in the dashboard", () => {
		render(
			<CloudTaskBadge
				cloudTask={{
					sessionId: "ses-ready",
					status: "running",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=ses-ready",
				}}
			/>,
		)

		const badge = screen.getByRole("button")
		expect(badge).toBeEnabled()
		fireEvent.click(badge)
		expect(mocks.openCloudSessionDashboard).toHaveBeenCalledWith(expect.objectContaining({ value: "ses-ready" }))
	})
})
