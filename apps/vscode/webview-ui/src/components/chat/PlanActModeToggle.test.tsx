import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import PlanActModeToggle from "./PlanActModeToggle"

describe("PlanActModeToggle a11y", () => {
	const defaultProps = {
		mode: "plan" as const,
		onModeToggle: vi.fn(),
	}

	it("renders as a radiogroup with an accessible name", () => {
		render(<PlanActModeToggle {...defaultProps} />)
		const group = screen.getByRole("radiogroup", { name: "Mode selection" })
		expect(group).toBeInTheDocument()
	})

	it("exposes the active mode as the only tab stop", () => {
		render(<PlanActModeToggle {...defaultProps} mode="plan" />)
		const plan = screen.getByRole("radio", { name: "Plan mode" })
		const act = screen.getByRole("radio", { name: "Act mode" })
		expect(plan).toHaveAttribute("aria-checked", "true")
		expect(act).toHaveAttribute("aria-checked", "false")
		expect(plan).toHaveAttribute("tabindex", "0")
		expect(act).toHaveAttribute("tabindex", "-1")
	})

	it("flips the tab stop when the mode changes", () => {
		render(<PlanActModeToggle {...defaultProps} mode="act" />)
		const plan = screen.getByRole("radio", { name: "Plan mode" })
		const act = screen.getByRole("radio", { name: "Act mode" })
		expect(plan).toHaveAttribute("tabindex", "-1")
		expect(act).toHaveAttribute("tabindex", "0")
		expect(act).toHaveAttribute("aria-checked", "true")
	})

	it("calls onModeToggle when clicked", async () => {
		const onModeToggle = vi.fn()
		render(<PlanActModeToggle {...defaultProps} onModeToggle={onModeToggle} />)
		screen.getByRole("radiogroup").click()
		expect(onModeToggle).toHaveBeenCalledTimes(1)
	})

	it("cycles the mode with arrow keys in both directions", () => {
		const onModeToggle = vi.fn()
		const { rerender } = render(<PlanActModeToggle {...defaultProps} onModeToggle={onModeToggle} />)
		const group = screen.getByRole("radiogroup")

		fireEvent.keyDown(group, { key: "ArrowRight" })
		fireEvent.keyDown(group, { key: "ArrowLeft" })
		expect(onModeToggle).toHaveBeenCalledTimes(2)

		// In act mode, arrow keys still toggle (cycle back to plan).
		rerender(<PlanActModeToggle mode="act" onModeToggle={onModeToggle} />)
		fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" })
		expect(onModeToggle).toHaveBeenCalledTimes(3)
	})

	it("toggles the mode on Enter and Space", () => {
		const onModeToggle = vi.fn()
		render(<PlanActModeToggle {...defaultProps} onModeToggle={onModeToggle} />)
		const group = screen.getByRole("radiogroup")
		fireEvent.keyDown(group, { key: "Enter" })
		fireEvent.keyDown(group, { key: " " })
		expect(onModeToggle).toHaveBeenCalledTimes(2)
	})
})
