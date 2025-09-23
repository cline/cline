// npx vitest run src/components/chat/checkpoints/__tests__/CheckpointSaved.spec.tsx

vi.mock("@/components/ui", () => {
	// Minimal UI primitives to ensure deterministic behavior in tests
	return {
		Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
		StandardTooltip: ({ children }: any) => <>{children}</>,
		Popover: ({ children, onOpenChange, open }: any) => {
			lastOnOpenChange = onOpenChange
			return (
				<div data-testid="popover-root" data-open={open}>
					{children}
				</div>
			)
		},
		PopoverTrigger: ({ children }: any) => <div data-testid="popover-trigger">{children}</div>,
		PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
	}
})

import { render, waitFor, screen } from "@/utils/test-utils"
import React from "react"
import userEvent from "@testing-library/user-event"
import { CheckpointSaved } from "../CheckpointSaved"

// Capture onOpenChange from Popover to control open/close in tests
let lastOnOpenChange: ((open: boolean) => void) | undefined

const waitForOpenHandler = async () => {
	await waitFor(() => {
		// ensure Popover mock captured the onOpenChange handler before using it
		expect(lastOnOpenChange).toBeTruthy()
	})
}

describe("CheckpointSaved popover visibility", () => {
	// Timers are controlled per-test to avoid interfering with i18n init
	const baseProps = {
		ts: 123,
		commitHash: "abc123",
		currentHash: "zzz999",
		checkpoint: { from: "prev123", to: "abc123" } as Record<string, unknown>,
	}

	it("shows menu while popover is open and hides when closed", async () => {
		const { getByTestId } = render(<CheckpointSaved {...baseProps} />)

		const getMenu = () => getByTestId("checkpoint-menu-container") as HTMLElement

		// Initially hidden (relies on group-hover)
		expect(getMenu()).toBeTruthy()
		expect(getMenu().className).toContain("hidden")

		// Open via captured handler
		await waitForOpenHandler()
		lastOnOpenChange?.(true)

		await waitFor(() => {
			expect(getMenu().className).toContain("block")
			expect(getMenu().className).not.toContain("hidden")
		})

		// Close via captured handler — menu remains visible briefly, then hides
		lastOnOpenChange?.(false)

		await waitFor(() => {
			expect(getMenu().className).toContain("block")
		})

		await waitFor(() => {
			expect(getMenu().className).toContain("hidden")
		})
	})

	it("resets confirm state when popover closes", async () => {
		const { getByTestId } = render(<CheckpointSaved {...baseProps} />)

		// Open the popover
		await waitForOpenHandler()
		lastOnOpenChange?.(true)

		// Enter confirm state
		const restoreFilesAndTaskBtn = await waitFor(() => getByTestId("restore-files-and-task-btn"))
		await userEvent.click(restoreFilesAndTaskBtn)

		// Confirm warning should be visible
		expect(getByTestId("checkpoint-confirm-warning")).toBeTruthy()

		// Close popover -> confirm state should reset
		lastOnOpenChange?.(false)

		// Reopen
		lastOnOpenChange?.(true)

		// Confirm warning should be gone after reopening
		await waitFor(() => {
			expect(screen.queryByTestId("checkpoint-confirm-warning")).toBeNull()
		})
	})

	it("closes popover after preview and after confirm restore", async () => {
		const { getByTestId } = render(<CheckpointSaved {...baseProps} />)

		const popoverRoot = () => getByTestId("popover-root")
		const menuContainer = () => getByTestId("checkpoint-menu-container")

		// Open
		await waitForOpenHandler()
		lastOnOpenChange?.(true)
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("true")
			expect(menuContainer().className).toContain("block")
		})

		// Click preview -> popover closes; menu remains briefly visible, then hides
		await userEvent.click(getByTestId("restore-files-btn"))
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("false")
			expect(menuContainer().className).toContain("block")
		})
		await waitFor(() => {
			expect(menuContainer().className).toContain("hidden")
		})

		// Reopen
		lastOnOpenChange?.(true)
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("true")
		})

		// Enter confirm and confirm restore -> popover closes; menu then hides
		await userEvent.click(getByTestId("restore-files-and-task-btn"))
		await userEvent.click(getByTestId("confirm-restore-btn"))
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("false")
		})
		await waitFor(() => {
			expect(menuContainer().className).toContain("hidden")
		})
	})
})
