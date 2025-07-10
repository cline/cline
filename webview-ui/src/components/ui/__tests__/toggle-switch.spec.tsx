import React from "react"
import { render, fireEvent, screen } from "@/utils/test-utils"

import { ToggleSwitch } from "../toggle-switch"

describe("ToggleSwitch", () => {
	it("renders with correct initial state", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={true} onChange={onChange} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		expect(toggle).toBeInTheDocument()
		expect(toggle).toHaveAttribute("aria-checked", "true")
		expect(toggle).toHaveAttribute("aria-label", "Test toggle")
	})

	it("renders unchecked state correctly", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		expect(toggle).toHaveAttribute("aria-checked", "false")
	})

	it("calls onChange when clicked", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		fireEvent.click(toggle)

		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it("calls onChange when Enter key is pressed", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		fireEvent.keyDown(toggle, { key: "Enter" })

		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it("calls onChange when Space key is pressed", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		fireEvent.keyDown(toggle, { key: " " })

		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it("does not call onChange when disabled", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} disabled={true} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		fireEvent.click(toggle)
		fireEvent.keyDown(toggle, { key: "Enter" })

		expect(onChange).not.toHaveBeenCalled()
	})

	it("has correct tabIndex when disabled", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} disabled={true} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		expect(toggle).toHaveAttribute("tabindex", "-1")
	})

	it("renders with custom data-testid", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} data-testid="custom-toggle" />)

		const toggle = screen.getByTestId("custom-toggle")
		expect(toggle).toBeInTheDocument()
	})

	it("supports medium size", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} size="medium" aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		expect(toggle).toBeInTheDocument()
		// Medium size should be 20px x 10px
		expect(toggle).toHaveStyle({ width: "20px", height: "10px" })
	})

	it("defaults to small size", () => {
		const onChange = vi.fn()
		render(<ToggleSwitch checked={false} onChange={onChange} aria-label="Test toggle" />)

		const toggle = screen.getByRole("switch")
		expect(toggle).toBeInTheDocument()
		// Small size should be 16px x 8px
		expect(toggle).toHaveStyle({ width: "16px", height: "8px" })
	})
})
