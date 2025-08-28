import { render, screen, fireEvent } from "@testing-library/react"

import { MaxRequestsInput } from "../MaxRequestsInput"

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => {
		const translations: Record<string, string> = {
			"settings:autoApprove.apiRequestLimit.title": "Max Count",
			"settings:autoApprove.apiRequestLimit.unlimited": "Unlimited",
		}
		return { t: (key: string) => translations[key] || key }
	},
}))

describe("MaxRequestsInput", () => {
	const mockOnValueChange = vi.fn()

	beforeEach(() => {
		mockOnValueChange.mockClear()
	})

	it("shows empty input when allowedMaxRequests is undefined", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		expect(input).toHaveValue("")
	})

	it("shows formatted request value when allowedMaxRequests is provided", () => {
		render(<MaxRequestsInput allowedMaxRequests={10} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		expect(input).toHaveValue("10")
	})

	it("calls onValueChange when input changes", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "5" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(5)
	})

	it("calls onValueChange with undefined when input is cleared", () => {
		render(<MaxRequestsInput allowedMaxRequests={5} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(undefined)
	})

	it("handles integer input correctly", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "25" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(25)
	})

	it("rejects zero and negative values", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")

		fireEvent.input(input, { target: { value: "0" } })
		expect(mockOnValueChange).toHaveBeenCalledWith(undefined)

		fireEvent.input(input, { target: { value: "-5" } })
		expect(mockOnValueChange).toHaveBeenCalledWith(undefined)
	})

	it("filters non-numeric characters", () => {
		render(<MaxRequestsInput allowedMaxRequests={undefined} onValueChange={mockOnValueChange} />)

		const input = screen.getByPlaceholderText("Unlimited")
		fireEvent.input(input, { target: { value: "123abc" } })

		expect(mockOnValueChange).toHaveBeenCalledWith(123)
	})
})
