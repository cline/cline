import { render, screen, fireEvent } from "@testing-library/react"
import { TemperatureControl } from "../TemperatureControl"

describe("TemperatureControl", () => {
	it("renders with default temperature disabled", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={undefined} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).not.toBeChecked()
		expect(screen.queryByRole("slider")).not.toBeInTheDocument()
	})

	it("renders with custom temperature enabled", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()

		const slider = screen.getByRole("slider")
		expect(slider).toBeInTheDocument()
		expect(slider).toHaveValue("0.7")
	})

	it("updates when checkbox is toggled", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")

		// Uncheck - should clear temperature
		fireEvent.click(checkbox)
		expect(onChange).toHaveBeenCalledWith(undefined)

		// Check - should restore previous temperature
		fireEvent.click(checkbox)
		expect(onChange).toHaveBeenCalledWith(0.7)
	})

	it("updates temperature when slider changes", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const slider = screen.getByRole("slider")
		fireEvent.change(slider, { target: { value: "0.8" } })

		expect(onChange).toHaveBeenCalledWith(0.8)
	})

	it("respects maxValue prop", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={1.5} onChange={onChange} maxValue={2} />)

		const slider = screen.getByRole("slider")
		expect(slider).toHaveAttribute("max", "2")
	})

	it("syncs checkbox state when value prop changes", () => {
		const onChange = jest.fn()
		const { rerender } = render(<TemperatureControl value={0.7} onChange={onChange} />)

		// Initially checked
		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()

		// Update to undefined
		rerender(<TemperatureControl value={undefined} onChange={onChange} />)
		expect(checkbox).not.toBeChecked()

		// Update back to a value
		rerender(<TemperatureControl value={0.5} onChange={onChange} />)
		expect(checkbox).toBeChecked()
	})
})
