import React, { ReactNode } from "react"
import { render, screen } from "@testing-library/react"
import { SelectDropdown } from "../select-dropdown"

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

	it("renders with width: 100% for proper sizing", () => {
		render(<SelectDropdown value="option1" options={options} onChange={onChangeMock} />)

		const trigger = screen.getByTestId("dropdown-trigger")
		expect(trigger).toHaveStyle("width: 100%")
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
})
