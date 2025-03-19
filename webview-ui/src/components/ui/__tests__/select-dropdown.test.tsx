// npx jest src/components/ui/__tests__/select-dropdown.test.tsx

import { ReactNode } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { SelectDropdown, DropdownOptionType } from "../select-dropdown"

// Mock window.postMessage
const postMessageMock = jest.fn()
Object.defineProperty(window, "postMessage", {
	writable: true,
	value: postMessageMock,
})

// Mock the Radix UI DropdownMenu component and its children
jest.mock("../dropdown-menu", () => {
	return {
		DropdownMenu: ({ children }: { children: ReactNode }) => <div data-testid="dropdown-root">{children}</div>,

		DropdownMenuTrigger: ({
			children,
			disabled,
			...props
		}: {
			children: ReactNode
			disabled?: boolean
			[key: string]: any
		}) => (
			<button data-testid="dropdown-trigger" disabled={disabled} {...props}>
				{children}
			</button>
		),

		DropdownMenuContent: ({ children }: { children: ReactNode }) => (
			<div data-testid="dropdown-content">{children}</div>
		),

		DropdownMenuItem: ({
			children,
			onClick,
			disabled,
		}: {
			children: ReactNode
			onClick?: () => void
			disabled?: boolean
		}) => (
			<div data-testid="dropdown-item" onClick={onClick} aria-disabled={disabled}>
				{children}
			</div>
		),

		DropdownMenuSeparator: () => <div data-testid="dropdown-separator" />,

		DropdownMenuShortcut: ({ children }: { children: ReactNode }) => (
			<span data-testid="dropdown-shortcut">{children}</span>
		),
	}
})

describe("SelectDropdown", () => {
	const options = [
		{ value: "option1", label: "Option 1" },
		{ value: "option2", label: "Option 2" },
		{ value: "option3", label: "Option 3" },
		{ value: "sep-1", label: "────", disabled: true },
		{ value: "action", label: "Action Item" },
	]

	const onChangeMock = jest.fn()

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders correctly with default props", () => {
		render(<SelectDropdown value="option1" options={options} onChange={onChangeMock} />)

		// Check that the selected option is displayed in the trigger, not in a menu item
		const trigger = screen.getByTestId("dropdown-trigger")
		expect(trigger).toHaveTextContent("Option 1")
	})

	it("handles disabled state correctly", () => {
		render(<SelectDropdown value="option1" options={options} onChange={onChangeMock} disabled={true} />)

		const trigger = screen.getByTestId("dropdown-trigger")
		expect(trigger).toHaveAttribute("disabled")
	})

	it("passes the selected value to the trigger", () => {
		const { rerender } = render(<SelectDropdown value="option1" options={options} onChange={onChangeMock} />)

		// Check initial render using testId to be specific
		const trigger = screen.getByTestId("dropdown-trigger")
		expect(trigger).toHaveTextContent("Option 1")

		// Rerender with a different value
		rerender(<SelectDropdown value="option3" options={options} onChange={onChangeMock} />)

		// Check updated render
		expect(trigger).toHaveTextContent("Option 3")
	})

	it("applies custom className to trigger when provided", () => {
		render(
			<SelectDropdown
				value="option1"
				options={options}
				onChange={onChangeMock}
				triggerClassName="custom-trigger-class"
			/>,
		)

		const trigger = screen.getByTestId("dropdown-trigger")
		expect(trigger.classList.toString()).toContain("custom-trigger-class")
	})

	it("ensures open state is controlled via props", () => {
		// Test that the component accepts and uses the open state controlled prop
		render(<SelectDropdown value="option1" options={options} onChange={onChangeMock} />)

		// The component should render the dropdown root with correct props
		const dropdown = screen.getByTestId("dropdown-root")
		expect(dropdown).toBeInTheDocument()

		// Verify trigger and content are rendered
		const trigger = screen.getByTestId("dropdown-trigger")
		const content = screen.getByTestId("dropdown-content")
		expect(trigger).toBeInTheDocument()
		expect(content).toBeInTheDocument()
	})

	// Tests for the new functionality
	describe("Option types", () => {
		it("renders separator options correctly", () => {
			const optionsWithTypedSeparator = [
				{ value: "option1", label: "Option 1" },
				{ value: "sep-1", label: "Separator", type: DropdownOptionType.SEPARATOR },
				{ value: "option2", label: "Option 2" },
			]

			render(<SelectDropdown value="option1" options={optionsWithTypedSeparator} onChange={onChangeMock} />)

			// Check for separator
			const separators = screen.getAllByTestId("dropdown-separator")
			expect(separators.length).toBe(1)
		})

		it("renders shortcut options correctly", () => {
			const shortcutText = "Ctrl+K"
			const optionsWithShortcut = [
				{ value: "shortcut", label: shortcutText, type: DropdownOptionType.SHORTCUT },
				{ value: "option1", label: "Option 1" },
			]

			render(
				<SelectDropdown
					value="option1"
					options={optionsWithShortcut}
					onChange={onChangeMock}
					shortcutText={shortcutText}
				/>,
			)

			expect(screen.queryByText(shortcutText)).toBeInTheDocument()
			const dropdownItems = screen.getAllByTestId("dropdown-item")
			expect(dropdownItems.length).toBe(2)
		})

		it("handles action options correctly", () => {
			const optionsWithAction = [
				{ value: "option1", label: "Option 1" },
				{ value: "settingsButtonClicked", label: "Settings", type: DropdownOptionType.ACTION },
			]

			render(<SelectDropdown value="option1" options={optionsWithAction} onChange={onChangeMock} />)

			// Get all dropdown items
			const dropdownItems = screen.getAllByTestId("dropdown-item")

			// Click the action item
			fireEvent.click(dropdownItems[1])

			// Check that postMessage was called with the correct action
			expect(postMessageMock).toHaveBeenCalledWith({
				type: "action",
				action: "settingsButtonClicked",
			})

			// The onChange callback should not be called for action items
			expect(onChangeMock).not.toHaveBeenCalled()
		})

		it("only treats options with explicit ACTION type as actions", () => {
			const optionsForTest = [
				{ value: "option1", label: "Option 1" },
				// This should be treated as a regular option despite the -action suffix
				{ value: "settings-action", label: "Regular option with action suffix" },
				// This should be treated as an action
				{ value: "settingsButtonClicked", label: "Settings", type: DropdownOptionType.ACTION },
			]

			render(<SelectDropdown value="option1" options={optionsForTest} onChange={onChangeMock} />)

			// Get all dropdown items
			const dropdownItems = screen.getAllByTestId("dropdown-item")

			// Click the second option (with action suffix but no ACTION type)
			fireEvent.click(dropdownItems[1])

			// Should trigger onChange, not postMessage
			expect(onChangeMock).toHaveBeenCalledWith("settings-action")
			expect(postMessageMock).not.toHaveBeenCalled()

			// Reset mocks
			onChangeMock.mockReset()
			postMessageMock.mockReset()

			// Click the third option (ACTION type)
			fireEvent.click(dropdownItems[2])

			// Should trigger postMessage with "settingsButtonClicked", not onChange
			expect(postMessageMock).toHaveBeenCalledWith({
				type: "action",
				action: "settingsButtonClicked",
			})
			expect(onChangeMock).not.toHaveBeenCalled()
		})

		it("calls onChange for regular menu items", () => {
			render(<SelectDropdown value="option1" options={options} onChange={onChangeMock} />)

			// Get all dropdown items
			const dropdownItems = screen.getAllByTestId("dropdown-item")

			// Click the second option (index 1)
			fireEvent.click(dropdownItems[1])

			// Check that onChange was called with the correct value
			expect(onChangeMock).toHaveBeenCalledWith("option2")

			// postMessage should not be called for regular items
			expect(postMessageMock).not.toHaveBeenCalled()
		})
	})
})
