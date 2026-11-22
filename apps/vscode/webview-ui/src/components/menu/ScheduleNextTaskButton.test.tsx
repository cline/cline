import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ScheduleNextTaskButton } from "./ScheduleNextTaskButton"

const { state, navigateToScheduledTasks } = vi.hoisted(() => ({
	state: { current: {} as Record<string, unknown> },
	navigateToScheduledTasks: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => state.current }))
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { updateScheduledTasks: vi.fn(async () => ({})) } }))

describe("ScheduleNextTaskButton", () => {
	beforeEach(() => {
		navigateToScheduledTasks.mockClear()
		state.current = { mode: "act", scheduledTasks: [], navigateToScheduledTasks }
	})

	it("opens the scheduled-tasks page and reads as inactive while the queue is empty", () => {
		render(<ScheduleNextTaskButton />)

		const button = screen.getByRole("button", { name: "Scheduled Tasks" })
		expect(button.getAttribute("aria-pressed")).toBe("false")
		expect(screen.queryByTestId("tab-schedule-next-task-count")).toBeNull()

		fireEvent.click(button)
		// The queue is a page rendered in the root view, not something this button
		// owns; it only asks the shared state to show it.
		expect(navigateToScheduledTasks).toHaveBeenCalledTimes(1)
	})

	it("reads as active and counts the queued chats without touching the task", () => {
		state.current = {
			mode: "act",
			scheduledTasks: [
				{ id: "row-1", message: "Write the tests", mode: "plan", includeSummary: false, createdAt: 1 },
				{ id: "row-2", message: "Write the changelog", mode: "act", includeSummary: true, createdAt: 2 },
			],
			navigateToScheduledTasks,
		}
		render(<ScheduleNextTaskButton />)

		expect(screen.getByRole("button", { name: "Scheduled Tasks" }).getAttribute("aria-pressed")).toBe("true")
		expect(screen.getByTestId("tab-schedule-next-task-count").textContent).toBe("2")
	})
})
