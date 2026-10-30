import type { CloudHandoffView } from "@shared/cloud/cloud-handoff"
import { act, fireEvent, render, screen } from "@testing-library/react"
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
let viewingSource = true
let taskId = "local-task"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ cloudHandoff: viewingSource ? view : undefined, currentTaskItem: { id: taskId } }),
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
		viewingSource = true
		taskId = "local-task"
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
		fireEvent.click(screen.getByRole("button", { name: "Open cloud task" }))
		expect(clients.showTaskWithId).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: "ses-cloud-task" }))
		expect(clients.openCloudSessionDashboard).not.toHaveBeenCalled()
		expect(screen.queryByRole("button", { name: "Open in browser" })).not.toBeInTheDocument()
	})

	it("disables navigation while sending without offering a browser shortcut", () => {
		view = { id: "handoff", sourceTaskId: "local-task", phase: "launching", sessionId: "ses-cloud-task" }
		render(<CloudHandoff />)
		const open = screen.getByRole("button", { name: "Open cloud task" })
		expect(open).toBeDisabled()
		fireEvent.click(open)
		expect(clients.showTaskWithId).not.toHaveBeenCalled()
		expect(screen.queryByRole("button", { name: "Open in browser" })).not.toBeInTheDocument()
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

	it("protects recovery until restored and exposes a failed discard for retry", async () => {
		view = { id: "handoff", sourceTaskId: "local-task", phase: "failed", message: "Launch failed" }
		const restore = vi.fn().mockRejectedValue(new Error("Discard unavailable"))
		const discard = vi.fn().mockResolvedValue(undefined)
		const { rerender } = render(<CloudHandoff onDiscardDraft={discard} onRestoreDraft={restore} />)
		expect(screen.queryByRole("button", { name: "Dismiss handoff" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Discard saved draft" }))
		expect(discard).toHaveBeenCalledOnce()
		fireEvent.click(screen.getByRole("button", { name: "Restore draft" }))
		await screen.findByText("Discard unavailable")
		expect(restore).toHaveBeenCalledOnce()
		rerender(<CloudHandoff />)
		expect(screen.queryByRole("button", { name: "Restore draft" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Dismiss handoff" }))
		expect(clients.discardHandoff).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: "handoff" }))
	})

	it("renders only local recovery when the account-bound handoff is gone", () => {
		viewingSource = false
		const restore = vi.fn().mockResolvedValue(undefined)
		const discard = vi.fn().mockResolvedValue(undefined)
		const { rerender } = render(<CloudHandoff onDiscardDraft={discard} onRestoreDraft={restore} />)
		expect(screen.getByRole("status")).toHaveTextContent("saved locally")
		expect(screen.queryByRole("button", { name: "Open cloud task" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Retry continuation" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Discard saved draft" }))
		expect(discard).toHaveBeenCalledOnce()
		rerender(<CloudHandoff />)
		expect(screen.queryByRole("region", { name: "Cloud handoff" })).not.toBeInTheDocument()
		expect(clients.discardHandoff).not.toHaveBeenCalled()
	})

	it("does not carry local recovery errors into another conversation", async () => {
		viewingSource = false
		const restore = vi.fn().mockRejectedValue(new Error("Move or clear your current draft"))
		const { rerender } = render(<CloudHandoff onRestoreDraft={restore} />)
		fireEvent.click(screen.getByRole("button", { name: "Restore draft" }))
		await screen.findByRole("alert")
		taskId = "other-task"
		rerender(<CloudHandoff />)
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("shows a failed in-panel open without silently launching a browser", async () => {
		clients.showTaskWithId.mockRejectedValue(new Error("Cloud session is unavailable."))
		render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Open cloud task" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Cloud session is unavailable.")
		expect(clients.openCloudSessionDashboard).not.toHaveBeenCalled()
		expect(screen.queryByRole("button", { name: "Open cloud task" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Open in browser" }))
		expect(clients.openCloudSessionDashboard).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ value: "ses-cloud-task" }),
		)
	})
	it("does not offer browser navigation for continuation recovery errors", async () => {
		view = { ...view, phase: "complete", sessionId: "ses-cloud-task", delivery: "unsent" }
		clients.retryHandoffMessage.mockRejectedValue(new Error("Retry failed"))
		render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Retry continuation" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Retry failed")
		expect(screen.getByRole("button", { name: "Open cloud task" })).toBeEnabled()
		expect(screen.queryByRole("button", { name: "Open in browser" })).not.toBeInTheDocument()
		expect(clients.showTaskWithId).not.toHaveBeenCalled()
	})

	it.each(["attempt", "session"])("ignores a late native failure after the %s changes", async (change) => {
		let rejectOpen: (reason: Error) => void = () => {}
		clients.showTaskWithId.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				rejectOpen = reject
			}),
		)
		const { rerender } = render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Open cloud task" }))
		view = {
			...view,
			phase: "complete",
			sessionId: change === "session" ? "ses-next" : "ses-cloud-task",
			id: change === "attempt" ? "next" : "handoff",
			delivery: "sent",
		}
		rerender(<CloudHandoff />)
		await act(async () => rejectOpen(new Error("Old open failed")))
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Open in browser" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Open cloud task" }))
		expect(clients.showTaskWithId).toHaveBeenLastCalledWith(expect.objectContaining({ value: view.sessionId }))
	})

	it("restores the native action for a new handoff after a failure", async () => {
		clients.showTaskWithId.mockRejectedValue(new Error("Open failed"))
		const { rerender } = render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Open cloud task" }))
		await screen.findByRole("button", { name: "Open in browser" })
		view = { ...view, id: "next" }
		rerender(<CloudHandoff />)
		expect(screen.getByRole("button", { name: "Open cloud task" })).toBeEnabled()
		expect(screen.queryByRole("button", { name: "Open in browser" })).not.toBeInTheDocument()
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
	})

	it("removes the notice away from the source and restores its recovery controls on return", () => {
		view = { id: "handoff", sourceTaskId: "local-task", phase: "complete", sessionId: "ses-cloud-task", delivery: "unsent" }
		const { rerender } = render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Open cloud task" }))
		expect(clients.showTaskWithId).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: "ses-cloud-task" }))
		viewingSource = false
		rerender(<CloudHandoff />)
		expect(screen.queryByRole("region", { name: "Cloud handoff" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Back to local" })).not.toBeInTheDocument()
		viewingSource = true
		rerender(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Retry continuation" }))
		expect(clients.retryHandoffMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ value: "handoff" }))
		expect(clients.openCloudSessionDashboard).not.toHaveBeenCalled()
	})
})
