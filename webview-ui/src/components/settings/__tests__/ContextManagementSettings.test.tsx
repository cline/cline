import { render, screen, fireEvent } from "@testing-library/react"
import { ContextManagementSettings } from "../ContextManagementSettings"

describe("ContextManagementSettings", () => {
	const defaultProps = {
		terminalOutputLineLimit: 500,
		maxOpenTabsContext: 20,
		maxWorkspaceFiles: 200,
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
		expect(screen.getByTestId("terminal-output-limit-slider")).toHaveValue("500")

		// Open tabs context limit
		expect(screen.getByText("Open tabs context limit")).toBeInTheDocument()
		expect(screen.getByTestId("open-tabs-limit-slider")).toHaveValue("20")

		// Workspace files limit
		expect(screen.getByText("Workspace files context limit")).toBeInTheDocument()
		expect(screen.getByTestId("workspace-files-limit-slider")).toHaveValue("200")

		// Show .rooignore'd files
		expect(screen.getByText("Show .rooignore'd files in lists and searches")).toBeInTheDocument()
		expect(screen.getByTestId("show-rooignored-files-checkbox")).not.toBeChecked()
	})

	it("updates terminal output limit", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const slider = screen.getByTestId("terminal-output-limit-slider")
		fireEvent.change(slider, { target: { value: "1000" } })

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("terminalOutputLineLimit", 1000)
	})

	it("updates open tabs context limit", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const slider = screen.getByTestId("open-tabs-limit-slider")
		fireEvent.change(slider, { target: { value: "50" } })

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("maxOpenTabsContext", 50)
	})

	it("updates workspace files contextlimit", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const slider = screen.getByTestId("workspace-files-limit-slider")
		fireEvent.change(slider, { target: { value: "50" } })

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("maxWorkspaceFiles", 50)
	})

	it("updates show rooignored files setting", () => {
		render(<ContextManagementSettings {...defaultProps} />)

		const checkbox = screen.getByTestId("show-rooignored-files-checkbox")
		fireEvent.click(checkbox)

		expect(defaultProps.setCachedStateField).toHaveBeenCalledWith("showRooIgnoredFiles", true)
	})
})
