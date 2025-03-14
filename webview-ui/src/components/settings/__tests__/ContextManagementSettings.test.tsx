import { render, screen, fireEvent } from "@testing-library/react"
import { ContextManagementSettings } from "../ContextManagementSettings"

describe("ContextManagementSettings", () => {
	const defaultProps = {
		terminalOutputLineLimit: 500,
		maxOpenTabsContext: 20,
		showRooIgnoredFiles: false,
		setCachedStateField: jest.fn(),
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders all controls", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		// Terminal output limit
		expect(screen.getByText("Terminal output limit")).toBeInTheDocument()
		expect(screen.getByRole("slider", { name: /Terminal output limit/i })).toHaveValue("500")

		// Open tabs context limit
		expect(screen.getByText("Open tabs context limit")).toBeInTheDocument()
		expect(screen.getByRole("slider", { name: /Open tabs context limit/i })).toHaveValue("20")

		// Show .rooignore'd files
		expect(screen.getByText("Show .rooignore'd files in lists and searches")).toBeInTheDocument()
		expect(screen.getByRole("checkbox")).not.toBeChecked()
	})

	it("updates terminal output limit", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const slider = screen.getByRole("slider", { name: /Terminal output limit/i })
		fireEvent.change(slider, { target: { value: "1000" } })

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("terminalOutputLineLimit", 1000)
	})

	it("updates open tabs context limit", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const slider = screen.getByRole("slider", { name: /Open tabs context limit/i })
		fireEvent.change(slider, { target: { value: "50" } })

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("maxOpenTabsContext", 50)
	})

	it("updates show rooignored files setting", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("showRooIgnoredFiles", true)
	})
})
