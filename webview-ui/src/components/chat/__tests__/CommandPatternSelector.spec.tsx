import React from "react"
import { render, screen, fireEvent, within } from "@testing-library/react"

import { CommandPatternSelector } from "../CommandPatternSelector"
import { TooltipProvider } from "../../../components/ui/tooltip"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	Trans: ({ i18nKey, children }: any) => <span>{i18nKey || children}</span>,
}))

// Mock VSCodeLink
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, onClick }: any) => (
		<a href="#" onClick={onClick}>
			{children}
		</a>
	),
}))

// Wrapper component with TooltipProvider
const TestWrapper = ({ children }: { children: React.ReactNode }) => <TooltipProvider>{children}</TooltipProvider>

describe("CommandPatternSelector", () => {
	const defaultProps = {
		patterns: [
			{ pattern: "npm install express", description: "Full command" },
			{ pattern: "npm install", description: "Install npm packages" },
			{ pattern: "npm *", description: "Any npm command" },
		],
		allowedCommands: ["npm install"],
		deniedCommands: ["git push"],
		onAllowPatternChange: vi.fn(),
		onDenyPatternChange: vi.fn(),
	}

	it("should render with command permissions header", () => {
		const { container } = render(
			<TestWrapper>
				<CommandPatternSelector {...defaultProps} />
			</TestWrapper>,
		)

		// The component should render without errors
		expect(container).toBeTruthy()

		// Check for the command permissions text
		expect(screen.getByText("chat:commandExecution.manageCommands")).toBeInTheDocument()
	})

	it("should show patterns when expanded", () => {
		render(
			<TestWrapper>
				<CommandPatternSelector {...defaultProps} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns. It's the next sibling of the button's parent div.
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText } = within(patternsContainer)

		// Check that the patterns are shown
		expect(getByText("npm install express")).toBeInTheDocument()
		expect(getByText("- Full command")).toBeInTheDocument()
	})

	it("should show extracted patterns when expanded", () => {
		render(
			<TestWrapper>
				<CommandPatternSelector {...defaultProps} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns. It's the next sibling of the button's parent div.
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText } = within(patternsContainer)

		// Check that patterns are shown
		expect(getByText("npm install")).toBeInTheDocument()
		expect(getByText("- Install npm packages")).toBeInTheDocument()
		expect(getByText("npm *")).toBeInTheDocument()
		expect(getByText("- Any npm command")).toBeInTheDocument()
	})

	it("should allow editing patterns when clicked", () => {
		render(
			<TestWrapper>
				<CommandPatternSelector {...defaultProps} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns. It's the next sibling of the button's parent div.
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText, getByDisplayValue } = within(patternsContainer)

		// Click on a pattern
		const patternDiv = getByText("npm install express").closest("div")
		fireEvent.click(patternDiv!)

		// An input should appear
		const input = getByDisplayValue("npm install express") as HTMLInputElement
		expect(input).toBeInTheDocument()

		// Change the value
		fireEvent.change(input, { target: { value: "npm install react" } })
		expect(input.value).toBe("npm install react")
	})

	it("should show allowed status for patterns in allowed list", () => {
		render(
			<TestWrapper>
				<CommandPatternSelector {...defaultProps} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText } = within(patternsContainer)

		// Find the npm install pattern row
		const npmInstallText = getByText("npm install")
		const npmInstallPattern = npmInstallText.closest(".flex")?.parentElement

		// The allow button should have the active styling (we can check by aria-label)
		const allowButton = npmInstallPattern?.querySelector('button[aria-label*="removeFromAllowed"]')
		expect(allowButton).toBeInTheDocument()
	})

	it("should show denied status for patterns in denied list", () => {
		const props = {
			...defaultProps,
			patterns: [{ pattern: "git push", description: "Push to git" }],
		}

		render(
			<TestWrapper>
				<CommandPatternSelector {...props} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText } = within(patternsContainer)

		// Find the git push pattern row
		const gitPushText = getByText("git push")
		const gitPushPattern = gitPushText.closest(".flex")?.parentElement

		// The deny button should have the active styling (we can check by aria-label)
		const denyButton = gitPushPattern?.querySelector('button[aria-label*="removeFromDenied"]')
		expect(denyButton).toBeInTheDocument()
	})

	it("should call onAllowPatternChange when allow button is clicked", () => {
		const mockOnAllowPatternChange = vi.fn()
		const props = {
			...defaultProps,
			onAllowPatternChange: mockOnAllowPatternChange,
		}

		render(
			<TestWrapper>
				<CommandPatternSelector {...props} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText } = within(patternsContainer)

		// Find a pattern row and click allow
		const patternText = getByText("npm install express")
		const patternRow = patternText.closest(".flex")?.parentElement
		const allowButton = patternRow?.querySelector('button[aria-label*="addToAllowed"]')
		fireEvent.click(allowButton!)

		// Check that the callback was called with the pattern
		expect(mockOnAllowPatternChange).toHaveBeenCalledWith("npm install express")
	})

	it("should call onDenyPatternChange when deny button is clicked", () => {
		const mockOnDenyPatternChange = vi.fn()
		const props = {
			...defaultProps,
			onDenyPatternChange: mockOnDenyPatternChange,
		}

		render(
			<TestWrapper>
				<CommandPatternSelector {...props} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText } = within(patternsContainer)

		// Find a pattern row and click deny
		const patternText = getByText("npm install express")
		const patternRow = patternText.closest(".flex")?.parentElement
		const denyButton = patternRow?.querySelector('button[aria-label*="addToDenied"]')
		fireEvent.click(denyButton!)

		// Check that the callback was called with the pattern
		expect(mockOnDenyPatternChange).toHaveBeenCalledWith("npm install express")
	})

	it("should use edited pattern value when buttons are clicked", () => {
		const mockOnAllowPatternChange = vi.fn()
		const props = {
			...defaultProps,
			onAllowPatternChange: mockOnAllowPatternChange,
		}

		render(
			<TestWrapper>
				<CommandPatternSelector {...props} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText, getByDisplayValue } = within(patternsContainer)

		// Click on a pattern to edit
		const patternDiv = getByText("npm install express").closest("div")
		fireEvent.click(patternDiv!)

		// Edit the pattern
		const input = getByDisplayValue("npm install express") as HTMLInputElement
		fireEvent.change(input, { target: { value: "npm install react" } })

		// Don't press Enter or blur - just click the button while still editing
		// This simulates the user clicking the button while the input is still focused

		// Find the allow button in the same row as the input
		const patternRow = input.closest(".flex")?.parentElement
		const allowButton = patternRow?.querySelector('button[aria-label*="addToAllowed"]')
		expect(allowButton).toBeInTheDocument()

		// Click the allow button - this should use the current edited value
		fireEvent.click(allowButton!)

		// Check that the callback was called with the edited pattern
		expect(mockOnAllowPatternChange).toHaveBeenCalledWith("npm install react")
	})

	it("should cancel edit on Escape key", () => {
		render(
			<TestWrapper>
				<CommandPatternSelector {...defaultProps} />
			</TestWrapper>,
		)

		// Find the button that expands the section
		const manageCommandsButton = screen.getByText("chat:commandExecution.manageCommands").closest("button")
		expect(manageCommandsButton).toBeInTheDocument()

		// Click to expand the component
		fireEvent.click(manageCommandsButton!)

		// Find the container for the patterns
		const patternsContainer = manageCommandsButton?.nextElementSibling as HTMLElement
		expect(patternsContainer).toBeInTheDocument()

		// Use within to query elements inside the patterns container
		const { getByText, getByDisplayValue, queryByDisplayValue } = within(patternsContainer)

		// Click on a pattern to edit
		const patternDiv = getByText("npm install express").closest("div")
		fireEvent.click(patternDiv!)

		// Edit the pattern
		const input = getByDisplayValue("npm install express") as HTMLInputElement
		fireEvent.change(input, { target: { value: "npm install react" } })

		// Press Escape to cancel
		fireEvent.keyDown(input, { key: "Escape" })

		// The original value should be restored
		expect(getByText("npm install express")).toBeInTheDocument()
		expect(queryByDisplayValue("npm install react")).not.toBeInTheDocument()
	})
})
