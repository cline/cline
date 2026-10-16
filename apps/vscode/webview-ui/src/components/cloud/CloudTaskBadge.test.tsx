import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CloudTaskBadge } from "./CloudTaskBadge"

const mocks = vi.hoisted(() => ({
	openCloudSessionDashboard: vi.fn(),
	resolveCloudSessionStatuses: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	CloudServiceClient: {
		openCloudSessionDashboard: mocks.openCloudSessionDashboard,
		resolveCloudSessionStatuses: mocks.resolveCloudSessionStatuses,
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
		mocks.resolveCloudSessionStatuses.mockResolvedValue({ statuses: [] })
	})

	it("does not open a client-only provisioning id in the dashboard", () => {
		render(
			<CloudTaskBadge
				cloudTask={{
					sessionId: "cloud-provisioning-1",
					status: "provisioning",
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
				}}
			/>,
		)

		const badge = screen.getByRole("button")
		expect(badge).toBeEnabled()
		fireEvent.click(badge)
		expect(mocks.openCloudSessionDashboard).toHaveBeenCalledWith(expect.objectContaining({ value: "ses-ready" }))
	})

	it("describes the task in whole sentences with and without a repository", () => {
		const { unmount } = render(
			<CloudTaskBadge
				cloudTask={{
					sessionId: "ses-ready",
					status: "running",
					repoUrl: "https://github.com/cline/fixture",
					branch: "main",
				}}
			/>,
		)
		expect(
			screen.getByText("Running in Cline Cloud on cline/fixture (main). Click to open in the dashboard."),
		).toBeInTheDocument()
		unmount()

		render(<CloudTaskBadge cloudTask={{ sessionId: "cloud-provisioning-1", status: "provisioning" }} />)
		expect(
			screen.getByText("Running in Cline Cloud. The dashboard link will be available when provisioning finishes."),
		).toBeInTheDocument()
	})

	it("does not present an unconfirmed status as an ongoing check", () => {
		mocks.resolveCloudSessionStatuses.mockReturnValue(new Promise(() => {}))
		const { container } = render(<CloudTaskBadge cloudTask={{ sessionId: "ses-checking", status: "unknown" }} />)

		expect(container.querySelector(".animate-spin")).not.toBeInTheDocument()
		expect(screen.getByText(/status could not be confirmed/)).toBeInTheDocument()
	})
})
