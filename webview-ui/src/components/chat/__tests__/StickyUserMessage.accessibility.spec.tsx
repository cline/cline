import type { ClineMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { StickyUserMessage } from "../task-header/StickyUserMessage"

describe("StickyUserMessage Accessibility", () => {
	const mockMessage: ClineMessage = {
		ts: 1234567890,
		type: "ask",
		ask: "followup",
		text: "Test user message",
	}

	const mockOnScrollToMessage = vi.fn()

	it("should render as button element", () => {
		render(<StickyUserMessage isVisible={true} lastUserMessage={mockMessage} onScrollToMessage={mockOnScrollToMessage} />)

		const button = screen.getByRole("button", { name: /Scroll to your message/i })
		expect(button.tagName).toBe("BUTTON")
		expect(button).toHaveAttribute("type", "button")
	})

	it("should be keyboard accessible with Tab", async () => {
		const user = userEvent.setup()
		render(<StickyUserMessage isVisible={true} lastUserMessage={mockMessage} onScrollToMessage={mockOnScrollToMessage} />)

		const button = screen.getByRole("button")
		await user.tab()
		expect(button).toHaveFocus()
	})

	it("should activate with Enter key", async () => {
		const user = userEvent.setup()
		render(<StickyUserMessage isVisible={true} lastUserMessage={mockMessage} onScrollToMessage={mockOnScrollToMessage} />)

		const button = screen.getByRole("button")
		button.focus()
		await user.keyboard("{Enter}")
		expect(mockOnScrollToMessage).toHaveBeenCalled()
	})

	it("should activate with Space key", async () => {
		const user = userEvent.setup()
		render(<StickyUserMessage isVisible={true} lastUserMessage={mockMessage} onScrollToMessage={mockOnScrollToMessage} />)

		const button = screen.getByRole("button")
		button.focus()
		await user.keyboard(" ")
		expect(mockOnScrollToMessage).toHaveBeenCalled()
	})

	it("should not render when not visible", () => {
		render(<StickyUserMessage isVisible={false} lastUserMessage={mockMessage} onScrollToMessage={mockOnScrollToMessage} />)

		expect(screen.queryByRole("button")).not.toBeInTheDocument()
	})
})
