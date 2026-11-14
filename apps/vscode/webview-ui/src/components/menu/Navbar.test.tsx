import { fireEvent, render, screen } from "@testing-library/react"
import type { ButtonHTMLAttributes, PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Navbar } from "./Navbar"

const navigateToChat = vi.fn()
vi.mock("../../context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		navigateToAccount: vi.fn(),
		navigateToChat,
		navigateToHistory: vi.fn(),
		navigateToMarketplace: vi.fn(),
		navigateToSettings: vi.fn(),
	}),
}))

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
	beforeEach(() => navigateToChat.mockClear())

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
})
