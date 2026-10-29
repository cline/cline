import type { CloudHandoffView } from "@shared/cloud/cloud-handoff"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CloudHandoff } from "./CloudHandoff"

const clients = vi.hoisted(() => ({
	showTaskWithId: vi.fn(),
	openCloudSessionDashboard: vi.fn(),
	retryHandoffMessage: vi.fn(),
	discardHandoff: vi.fn(),
}))
let view: CloudHandoffView

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ cloudHandoff: view }),
}))
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: { showTaskWithId: clients.showTaskWithId },
	CloudServiceClient: clients,
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ appearance: _appearance, ...props }: ComponentProps<"button"> & { appearance?: string }) => (
		<button {...props} />
	),
}))

describe("cloud handoff navigation", () => {
	beforeEach(() => {
		vi.resetAllMocks()
		clients.showTaskWithId.mockResolvedValue({})
		clients.openCloudSessionDashboard.mockResolvedValue({})
		view = {
			id: "handoff",
			sourceTaskId: "local-task",
			phase: "complete",
			sessionId: "ses-cloud-task",
			delivery: "sent",
		}
	})

	it.each(["sent", "unsent", "unconfirmed"] as const)("opens a %s task in Cline through History", (delivery) => {
		view = { ...view, phase: "complete", sessionId: "ses-cloud-task", delivery }
		render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Open in Cline" }))
		expect(clients.showTaskWithId).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: "ses-cloud-task" }))
		expect(clients.openCloudSessionDashboard).not.toHaveBeenCalled()
	})

	it("keeps browser navigation available while sending without allowing an in-panel switch", () => {
		view = { id: "handoff", sourceTaskId: "local-task", phase: "launching", sessionId: "ses-cloud-task" }
		render(<CloudHandoff />)
		const openInCline = screen.getByRole("button", { name: "Open in Cline" })
		expect(openInCline).toBeDisabled()
		fireEvent.click(openInCline)
		expect(clients.showTaskWithId).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "Open in browser" }))
		expect(clients.openCloudSessionDashboard).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ value: "ses-cloud-task" }),
		)
	})

	it("keeps recovery available until the continuation has been sent", () => {
		view = { ...view, phase: "complete", sessionId: "ses-cloud-task", delivery: "unsent" }
		const { rerender } = render(<CloudHandoff />)
		expect(screen.queryByRole("button", { name: "Dismiss handoff" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Retry continuation" }))
		expect(clients.retryHandoffMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: "handoff" }))
		view = { ...view, delivery: "sent" }
		rerender(<CloudHandoff />)
		expect(screen.queryByRole("button", { name: "Retry continuation" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Dismiss handoff" }))
		expect(clients.discardHandoff).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: "handoff" }))
	})

	it("shows a failed in-panel open without silently launching a browser", async () => {
		clients.showTaskWithId.mockRejectedValue(new Error("Cloud session is unavailable."))
		render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Open in Cline" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Cloud session is unavailable.")
		expect(clients.openCloudSessionDashboard).not.toHaveBeenCalled()
		expect(screen.getByRole("button", { name: "Open in browser" })).toBeEnabled()
	})
})
