import { render, screen, fireEvent } from "@testing-library/react"

import { FormattedTextField, unlimitedIntegerFormatter, unlimitedDecimalFormatter } from "../FormattedTextField"

// Mock VSCodeTextField to render as regular HTML input for testing
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ value, onInput, onBlur, placeholder, "data-testid": dataTestId }: any) => (
		<input
			type="text"
			value={value}
			onChange={(e) => onInput({ target: { value: e.target.value } })}
			onBlur={onBlur}
			placeholder={placeholder}
			data-testid={dataTestId}
		/>
	),
}))

describe("FormattedTextField", () => {
	describe("unlimitedIntegerFormatter", () => {
		it("should parse valid integers", () => {
			expect(unlimitedIntegerFormatter.parse("123")).toBe(123)
			expect(unlimitedIntegerFormatter.parse("1")).toBe(1)
		})

		it("should return undefined for empty input (unlimited)", () => {
			expect(unlimitedIntegerFormatter.parse("")).toBeUndefined()
			expect(unlimitedIntegerFormatter.parse("   ")).toBeUndefined()
		})

		it("should return undefined for invalid inputs", () => {
			expect(unlimitedIntegerFormatter.parse("0")).toBeUndefined()
			expect(unlimitedIntegerFormatter.parse("-5")).toBeUndefined()
			expect(unlimitedIntegerFormatter.parse("abc")).toBeUndefined()
		})

		it("should format numbers correctly, treating undefined/Infinity as empty", () => {
			expect(unlimitedIntegerFormatter.format(123)).toBe("123")
			expect(unlimitedIntegerFormatter.format(undefined)).toBe("")
			expect(unlimitedIntegerFormatter.format(Infinity)).toBe("")
		})

		it("should filter non-numeric characters", () => {
			expect(unlimitedIntegerFormatter.filter?.("123abc")).toBe("123")
			expect(unlimitedIntegerFormatter.filter?.("a1b2c3")).toBe("123")
		})
	})

	describe("FormattedTextField component", () => {
		it("should render with correct initial value", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={123}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input") as HTMLInputElement
			expect(input.value).toBe("123")
		})

		it("should render as HTML input (mock verification)", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={123}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input")
			expect(input.tagName).toBe("INPUT")
			expect(input).toHaveAttribute("type", "text")
		})

		it("should call onValueChange when input changes", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={undefined}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input")
			fireEvent.change(input, { target: { value: "456" } })
			expect(mockOnChange).toHaveBeenCalledWith(456)
		})

		it("should apply input filtering", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={undefined}
					onValueChange={mockOnChange}
					formatter={unlimitedIntegerFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input") as HTMLInputElement
			fireEvent.change(input, { target: { value: "123abc" } })
			expect(mockOnChange).toHaveBeenCalledWith(123)
		})
	})

	describe("unlimitedDecimalFormatter", () => {
		it("should parse valid decimal numbers", () => {
			expect(unlimitedDecimalFormatter.parse("123.45")).toBe(123.45)
			expect(unlimitedDecimalFormatter.parse("0.5")).toBe(0.5)
			expect(unlimitedDecimalFormatter.parse("1")).toBe(1)
			expect(unlimitedDecimalFormatter.parse("0")).toBe(0)
		})

		it("should return undefined for empty input (unlimited)", () => {
			expect(unlimitedDecimalFormatter.parse("")).toBeUndefined()
			expect(unlimitedDecimalFormatter.parse("   ")).toBeUndefined()
		})

		it("should return undefined for invalid inputs", () => {
			expect(unlimitedDecimalFormatter.parse("-5")).toBeUndefined()
			expect(unlimitedDecimalFormatter.parse("abc")).toBeUndefined()
		})

		it("should format numbers correctly, treating undefined/Infinity as empty", () => {
			expect(unlimitedDecimalFormatter.format(123.45)).toBe("123.45")
			expect(unlimitedDecimalFormatter.format(0)).toBe("0")
			expect(unlimitedDecimalFormatter.format(undefined)).toBe("")
			expect(unlimitedDecimalFormatter.format(Infinity)).toBe("")
		})

		it("should filter non-numeric characters except dots", () => {
			expect(unlimitedDecimalFormatter.filter?.("123.45abc")).toBe("123.45")
			expect(unlimitedDecimalFormatter.filter?.("a1b2.c3")).toBe("12.3")
		})

		it("should handle multiple dots by keeping only the first one", () => {
			expect(unlimitedDecimalFormatter.filter?.("1.2.3.4")).toBe("1.234")
			expect(unlimitedDecimalFormatter.filter?.("..123")).toBe(".123")
			expect(unlimitedDecimalFormatter.filter?.("1..2")).toBe("1.2")
		})

		it("should preserve trailing dots during typing", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={undefined}
					onValueChange={mockOnChange}
					formatter={unlimitedDecimalFormatter}
					data-testid="decimal-input"
				/>,
			)

			const input = screen.getByTestId("decimal-input") as HTMLInputElement

			// Type "1."
			fireEvent.change(input, { target: { value: "1." } })

			// The input should show "1." (preserving the dot)
			expect(input.value).toBe("1.")
			// But the parsed value should be 1
			expect(mockOnChange).toHaveBeenCalledWith(1)
		})

		it("should format properly on blur", async () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={1}
					onValueChange={mockOnChange}
					formatter={unlimitedDecimalFormatter}
					data-testid="decimal-input"
				/>,
			)

			const input = screen.getByTestId("decimal-input") as HTMLInputElement

			// Initially shows formatted value
			expect(input.value).toBe("1")

			// Type "1."
			fireEvent.change(input, { target: { value: "1." } })
			expect(input.value).toBe("1.")

			// On blur, should format back to "1"
			fireEvent.blur(input)

			// Wait for state update
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(input.value).toBe("1")
		})
	})

	describe("FormattedTextField with decimal formatter", () => {
		it("should handle decimal input correctly", () => {
			const mockOnChange = vi.fn()
			render(
				<FormattedTextField
					value={undefined}
					onValueChange={mockOnChange}
					formatter={unlimitedDecimalFormatter}
					data-testid="test-input"
				/>,
			)

			const input = screen.getByTestId("test-input")
			fireEvent.change(input, { target: { value: "12.34" } })
			expect(mockOnChange).toHaveBeenCalledWith(12.34)
		})
	})
})
