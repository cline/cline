import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { EditModeControls } from "../EditModeControls"
import { Mode } from "@roo/modes"

// Mock the translation hook
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock the UI components
vi.mock("@/components/ui", () => ({
	Button: ({ children, onClick, disabled, ...props }: any) => (
		<button onClick={onClick} disabled={disabled} {...props}>
			{children}
		</button>
	),
	StandardTooltip: ({ children, content }: any) => <div title={content}>{children}</div>,
}))

// Mock ModeSelector
vi.mock("../ModeSelector", () => ({
	default: ({ value, onChange, title }: any) => (
		<select value={value} onChange={(e) => onChange(e.target.value)} title={title}>
			<option value="code">Code</option>
			<option value="architect">Architect</option>
		</select>
	),
}))

describe("EditModeControls", () => {
	const defaultProps = {
		mode: "code" as Mode,
		onModeChange: vi.fn(),
		modeShortcutText: "Ctrl+M",
		customModes: [],
		customModePrompts: {},
		onCancel: vi.fn(),
		onSend: vi.fn(),
		onSelectImages: vi.fn(),
		sendingDisabled: false,
		shouldDisableImages: false,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders all controls correctly", () => {
		render(<EditModeControls {...defaultProps} />)

		// Check for mode selector
		expect(screen.getByTitle("chat:selectMode")).toBeInTheDocument()

		// Check for Cancel button
		expect(screen.getByText("Cancel")).toBeInTheDocument()

		// Check for image button
		expect(screen.getByTitle("chat:addImages")).toBeInTheDocument()

		// Check for send button
		expect(screen.getByTitle("chat:save.tooltip")).toBeInTheDocument()
	})

	it("calls onCancel when Cancel button is clicked", () => {
		render(<EditModeControls {...defaultProps} />)

		const cancelButton = screen.getByText("Cancel")
		fireEvent.click(cancelButton)

		expect(defaultProps.onCancel).toHaveBeenCalledTimes(1)
	})

	it("calls onSend when send button is clicked", () => {
		render(<EditModeControls {...defaultProps} />)

		const sendButton = screen.getByLabelText("chat:save.tooltip")
		fireEvent.click(sendButton)

		expect(defaultProps.onSend).toHaveBeenCalledTimes(1)
	})

	it("calls onSelectImages when image button is clicked", () => {
		render(<EditModeControls {...defaultProps} />)

		const imageButton = screen.getByLabelText("chat:addImages")
		fireEvent.click(imageButton)

		expect(defaultProps.onSelectImages).toHaveBeenCalledTimes(1)
	})

	it("disables buttons when sendingDisabled is true", () => {
		render(<EditModeControls {...defaultProps} sendingDisabled={true} />)

		const cancelButton = screen.getByText("Cancel")
		const sendButton = screen.getByLabelText("chat:save.tooltip")

		expect(cancelButton).toBeDisabled()
		expect(sendButton).toBeDisabled()
	})

	it("disables image button when shouldDisableImages is true", () => {
		render(<EditModeControls {...defaultProps} shouldDisableImages={true} />)

		const imageButton = screen.getByLabelText("chat:addImages")
		expect(imageButton).toBeDisabled()
	})

	it("does not call onSelectImages when image button is disabled", () => {
		render(<EditModeControls {...defaultProps} shouldDisableImages={true} />)

		const imageButton = screen.getByLabelText("chat:addImages")
		fireEvent.click(imageButton)

		expect(defaultProps.onSelectImages).not.toHaveBeenCalled()
	})

	it("does not call onSend when send button is disabled", () => {
		render(<EditModeControls {...defaultProps} sendingDisabled={true} />)

		const sendButton = screen.getByLabelText("chat:save.tooltip")
		fireEvent.click(sendButton)

		expect(defaultProps.onSend).not.toHaveBeenCalled()
	})

	it("calls onModeChange when mode is changed", () => {
		render(<EditModeControls {...defaultProps} />)

		const modeSelector = screen.getByTitle("chat:selectMode")
		fireEvent.change(modeSelector, { target: { value: "architect" } })

		expect(defaultProps.onModeChange).toHaveBeenCalledWith("architect")
	})
})
