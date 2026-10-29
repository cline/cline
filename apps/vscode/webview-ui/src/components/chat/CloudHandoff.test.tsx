import type { CloudHandoffView } from "@shared/cloud/cloud-handoff"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CloudHandoff } from "./CloudHandoff"
import { useChatState } from "./chat-view/hooks/useChatState"

const clients = vi.hoisted(() => ({
	showTaskWithId: vi.fn(),
	openCloudSessionDashboard: vi.fn(),
	retryHandoffMessage: vi.fn(),
	discardHandoff: vi.fn(),
}))
let view: CloudHandoffView
let currentCloudTask: { sessionId: string } | undefined

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ cloudHandoff: view, currentCloudTask }),
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
		currentCloudTask = undefined
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

	it("keeps failed return navigation in the cloud without offering a browser", async () => {
		currentCloudTask = { sessionId: "ses-cloud-task" }
		clients.showTaskWithId.mockRejectedValue(new Error("Local task unavailable"))
		render(<CloudHandoff />)
		fireEvent.click(screen.getByRole("button", { name: "Back to local" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("Local task unavailable")
		expect(screen.getAllByRole("button")).toHaveLength(1)
		expect(screen.getByRole("button", { name: "Back to local" })).toBeEnabled()
		expect(clients.openCloudSessionDashboard).not.toHaveBeenCalled()
	})
	it.each(["sent", "unsent", "unconfirmed"] as const)("preserves a local draft through a %s cloud roundtrip", (delivery) => {
		view = { ...view, phase: "complete", sessionId: "ses-cloud-task", delivery }
		function Conversation() {
			const draft = useChatState([{ ts: currentCloudTask ? 2 : 1, type: "say", say: "task", text: "Example conversation" }])
			return (
				<>
					<input
						aria-label="Draft"
						onChange={(event) => draft.setInputValue(event.target.value)}
						value={draft.inputValue}
					/>
					<CloudHandoff />
				</>
			)
		}
		const { rerender } = render(<Conversation />)
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "/cloud continue the task" } })
		fireEvent.click(screen.getByRole("button", { name: "Open cloud task" }))
		expect(clients.showTaskWithId).toHaveBeenNthCalledWith(1, expect.objectContaining({ value: "ses-cloud-task" }))
		currentCloudTask = { sessionId: "ses-cloud-task" }
		rerender(<Conversation />)
		expect(screen.getByRole("textbox")).toHaveValue("/cloud continue the task")
		expect(screen.getAllByRole("button")).toHaveLength(1)
		fireEvent.click(screen.getByRole("button", { name: "Back to local" }))
		expect(clients.showTaskWithId).toHaveBeenNthCalledWith(2, expect.objectContaining({ value: "local-task" }))
		currentCloudTask = undefined
		rerender(<Conversation />)
		expect(screen.getByRole("textbox")).toHaveValue("/cloud continue the task")
		expect(screen.queryByRole("alert")).not.toBeInTheDocument()
		expect(clients.openCloudSessionDashboard).not.toHaveBeenCalled()
		expect(clients.retryHandoffMessage).not.toHaveBeenCalled()
	})
})
