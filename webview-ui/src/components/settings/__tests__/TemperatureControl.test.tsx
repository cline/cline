import { render, screen, fireEvent } from "@testing-library/react"
import { TemperatureControl } from "../TemperatureControl"

describe("TemperatureControl", () => {
	it("renders with default temperature disabled", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={undefined} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).not.toBeChecked()
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
	})

	it("renders with custom temperature enabled", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()

		const input = screen.getByRole("textbox")
		expect(input).toBeInTheDocument()
		expect(input).toHaveValue("0.7")
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

	it("updates temperature when input loses focus", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const input = screen.getByRole("textbox")
		fireEvent.change(input, { target: { value: "0.8" } })
		fireEvent.blur(input)

		expect(onChange).toHaveBeenCalledWith(0.8)
	})

	it("respects maxValue prop", () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={1.5} onChange={onChange} maxValue={2} />)

		const input = screen.getByRole("textbox")

		// Valid value within max
		fireEvent.change(input, { target: { value: "1.8" } })
		fireEvent.blur(input)
		expect(onChange).toHaveBeenCalledWith(1.8)

		// Invalid value above max
		fireEvent.change(input, { target: { value: "2.5" } })
		fireEvent.blur(input)
		expect(input).toHaveValue("1.5") // Should revert to original value
		expect(onChange).toHaveBeenCalledTimes(1) // Should not call onChange for invalid value
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
