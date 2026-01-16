import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import AutoApproveBar from "../auto-approve-menu/AutoApproveBar"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: {
			actions: {},
			enableNotifications: false,
		},
		yoloModeToggled: false,
		navigateToSettings: vi.fn(),
	}),
}))
vi.mock("../auto-approve-menu/AutoApproveModal", () => ({
	default: () => null,
}))

describe("AutoApproveBar Accessibility", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should render toggle button as actual button element", () => {
		render(<AutoApproveBar />)

		const button = screen.getByRole("button", { name: /Open auto-approve settings/i })
		expect(button.tagName).toBe("BUTTON")
		expect(button).toHaveAttribute("type", "button")
	})

	it("should be keyboard accessible with Tab", async () => {
		const user = userEvent.setup()
		render(<AutoApproveBar />)

		const button = screen.getByRole("button")
		await user.tab()
		expect(button).toHaveFocus()
	})

	it("should toggle modal with Enter key", async () => {
		const user = userEvent.setup()
		render(<AutoApproveBar />)

		const button = screen.getByRole("button")
		expect(button).toHaveAttribute("aria-expanded", "false")
		button.focus()
		await user.keyboard("{Enter}")
		expect(button).toHaveAttribute("aria-expanded", "true")
	})

	it("should toggle modal with Space key", async () => {
		const user = userEvent.setup()
		render(<AutoApproveBar />)

		const button = screen.getByRole("button")
		expect(button).toHaveAttribute("aria-expanded", "false")
		button.focus()
		await user.keyboard(" ")
		expect(button).toHaveAttribute("aria-expanded", "true")
	})
})
