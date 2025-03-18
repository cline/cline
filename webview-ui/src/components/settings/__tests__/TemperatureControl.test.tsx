// npx jest src/components/settings/__tests__/TemperatureControl.test.ts

import { render, screen, fireEvent } from "@testing-library/react"

import { TemperatureControl } from "../TemperatureControl"

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

jest.mock("@/components/ui", () => ({
	...jest.requireActual("@/components/ui"),
	Slider: ({ value, onValueChange, "data-testid": dataTestId }: any) => (
		<input
			type="range"
			value={value[0]}
			onChange={(e) => onValueChange([parseFloat(e.target.value)])}
			data-testid={dataTestId}
		/>
	),
}))

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

		const input = screen.getByRole("slider")
		expect(input).toBeInTheDocument()
		expect(input).toHaveValue("0.7")
	})

	it("updates when checkbox is toggled", async () => {
		const onChange = jest.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")

		// Uncheck - should clear temperature.
		fireEvent.click(checkbox)

		// Waiting for debounce.
		await new Promise((x) => setTimeout(x, 100))
		expect(onChange).toHaveBeenCalledWith(null)

		// Check - should restore previous temperature.
		fireEvent.click(checkbox)

		// Waiting for debounce.
		await new Promise((x) => setTimeout(x, 100))
		expect(onChange).toHaveBeenCalledWith(0.7)
	})

	it("syncs checkbox state when value prop changes", () => {
		const onChange = jest.fn()
		const { rerender } = render(<TemperatureControl value={0.7} onChange={onChange} />)

		// Initially checked.
		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()

		// Update to undefined.
		rerender(<TemperatureControl value={undefined} onChange={onChange} />)
		expect(checkbox).not.toBeChecked()

		// Update back to a value.
		rerender(<TemperatureControl value={0.5} onChange={onChange} />)
		expect(checkbox).toBeChecked()
	})
})
