import { fireEvent, render, screen } from "@testing-library/react"
import type { ButtonHTMLAttributes, PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Navbar } from "./Navbar"

const { state, navigateToScheduledTasks } = vi.hoisted(() => ({
	state: { current: {} as Record<string, unknown> },
	navigateToScheduledTasks: vi.fn(),
}))

const navigateToChat = vi.fn()
vi.mock("../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		navigateToAccount: vi.fn(),
		navigateToChat,
		navigateToHistory: vi.fn(),
		navigateToMarketplace: vi.fn(),
		navigateToSettings: vi.fn(),
		navigateToScheduledTasks,
		...state.current,
	}),
}))
vi.mock("@/services/grpc-client", () => ({ TaskServiceClient: { updateScheduledTasks: vi.fn(async () => ({})) } }))
vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
		<button {...props}>{children}</button>
	),
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
	TooltipContent: ({ children }: PropsWithChildren) => <>{children}</>,
	TooltipTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
}))

describe("Navbar", () => {
	beforeEach(() => {
		navigateToChat.mockClear()
		navigateToScheduledTasks.mockClear()
		state.current = { scheduledTasks: [] }
	})

	it("starts a navbar task transition before navigating to chat", async () => {
		const startNewTask = vi.fn().mockResolvedValue(true)
		render(<Navbar startNewTask={startNewTask} />)

		fireEvent.click(screen.getByRole("button", { name: "New Task" }))

		await vi.waitFor(() => expect(startNewTask).toHaveBeenCalledWith("navbar"))
		expect(navigateToChat).toHaveBeenCalledTimes(1)
	})

	it("does not navigate when another recovery action owns the task", async () => {
		const startNewTask = vi.fn().mockResolvedValue(false)
		render(<Navbar startNewTask={startNewTask} />)

		fireEvent.click(screen.getByRole("button", { name: "New Task" }))

		await vi.waitFor(() => expect(startNewTask).toHaveBeenCalledWith("navbar"))
		expect(navigateToChat).not.toHaveBeenCalled()
	})

	it("puts the scheduled-tasks entry directly beside New Task", () => {
		render(<Navbar startNewTask={vi.fn().mockResolvedValue(true)} />)

		const labels = screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))
		expect(labels).toEqual(["New Task", "Scheduled Tasks", "Customize", "History", "Account", "Settings"])
	})

	it("opens the scheduled-tasks page without starting or clearing a task", () => {
		const startNewTask = vi.fn().mockResolvedValue(true)
		render(<Navbar startNewTask={startNewTask} />)

		fireEvent.click(screen.getByRole("button", { name: "Scheduled Tasks" }))

		// The navbar only asks the shared state to show the queue page; the task
		// in progress is left alone.
		expect(navigateToScheduledTasks).toHaveBeenCalledTimes(1)
		expect(startNewTask).not.toHaveBeenCalled()
		expect(navigateToChat).not.toHaveBeenCalled()
	})
})
