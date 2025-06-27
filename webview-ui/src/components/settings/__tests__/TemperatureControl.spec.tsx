// npx vitest src/components/settings/__tests__/TemperatureControl.spec.tsx

import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"

import { TemperatureControl } from "../TemperatureControl"

vi.mock("@/components/ui", () => ({
	...vi.importActual("@/components/ui"),
	Slider: ({ value, onValueChange, "data-testid": dataTestId }: any) => (
		<input
			type="range"
			value={value[0]}
			onChange={(e) => onValueChange([parseFloat(e.target.value)])}
			data-testid={dataTestId}
			role="slider"
		/>
	),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, onChange, checked, ...props }: any) => (
		<label>
			<input
				type="checkbox"
				role="checkbox"
				checked={checked || false}
				aria-checked={checked || false}
				onChange={(e: any) => onChange?.({ target: { checked: e.target.checked } })}
				{...props}
			/>
			{children}
		</label>
	),
}))

describe("TemperatureControl", () => {
	it("renders with default temperature disabled", () => {
		const onChange = vi.fn()
		render(<TemperatureControl value={undefined} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).not.toBeChecked()
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
	})

	it("renders with custom temperature enabled", () => {
		const onChange = vi.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()

		const input = screen.getByRole("slider")
		expect(input).toBeInTheDocument()
		expect(input).toHaveValue("0.7")
	})

	it("updates when checkbox is toggled", async () => {
		const onChange = vi.fn()
		render(<TemperatureControl value={0.7} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")

		// Uncheck - should clear temperature.
		fireEvent.click(checkbox)

		// Wait for debounced onChange call.
		await waitFor(() => {
			expect(onChange).toHaveBeenCalledWith(null)
		})

		// Check - should restore previous temperature.
		fireEvent.click(checkbox)

		// Wait for debounced onChange call.
		await waitFor(() => {
			expect(onChange).toHaveBeenCalledWith(0.7)
		})
	})

	it("syncs checkbox state when value prop changes", () => {
		const onChange = vi.fn()
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
