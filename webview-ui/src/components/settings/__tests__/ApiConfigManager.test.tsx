import { render, screen, fireEvent, within } from "@testing-library/react"
import ApiConfigManager from "../ApiConfigManager"

// Mock VSCode components
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick, title, disabled }: any) => (
		<button onClick={onClick} title={title} disabled={disabled}>
			{children}
		</button>
	),
	VSCodeTextField: ({ value, onInput, placeholder, onKeyDown }: any) => (
		<input
			value={value}
			onChange={(e) => onInput(e)}
			placeholder={placeholder}
			onKeyDown={onKeyDown}
			ref={undefined} // Explicitly set ref to undefined to avoid warning
		/>
	),
}))

jest.mock("vscrui", () => ({
	Dropdown: ({ id, value, onChange, options, role }: any) => (
		<div data-testid={`mock-dropdown-${id}`}>
			<select value={value} onChange={(e) => onChange({ value: e.target.value })} data-testid={id} role={role}>
				{options.map((opt: any) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
		</div>
	),
}))

// Mock Dialog component
jest.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children, open, onOpenChange }: any) => (
		<div role="dialog" aria-modal="true" style={{ display: open ? "block" : "none" }} data-testid="dialog">
			{children}
		</div>
	),
	DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
}))

describe("ApiConfigManager", () => {
	const mockOnSelectConfig = jest.fn()
	const mockOnDeleteConfig = jest.fn()
	const mockOnRenameConfig = jest.fn()
	const mockOnUpsertConfig = jest.fn()

	const defaultProps = {
		currentApiConfigName: "Default Config",
		listApiConfigMeta: [
			{ id: "default", name: "Default Config" },
			{ id: "another", name: "Another Config" },
		],
		onSelectConfig: mockOnSelectConfig,
		onDeleteConfig: mockOnDeleteConfig,
		onRenameConfig: mockOnRenameConfig,
		onUpsertConfig: mockOnUpsertConfig,
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	const getRenameForm = () => screen.getByTestId("rename-form")
	const getDialogContent = () => screen.getByTestId("dialog-content")

	it("opens new profile dialog when clicking add button", () => {
		render(<ApiConfigManager {...defaultProps} />)

		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		expect(screen.getByTestId("dialog")).toBeVisible()
		expect(screen.getByText("New Configuration Profile")).toBeInTheDocument()
	})

	it("creates new profile with entered name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		// Enter new profile name
		const input = screen.getByPlaceholderText("Enter profile name")
		fireEvent.input(input, { target: { value: "New Profile" } })

		// Click create button
		const createButton = screen.getByText("Create Profile")
		fireEvent.click(createButton)

		expect(mockOnUpsertConfig).toHaveBeenCalledWith("New Profile")
	})

	it("shows error when creating profile with existing name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		// Enter existing profile name
		const input = screen.getByPlaceholderText("Enter profile name")
		fireEvent.input(input, { target: { value: "Default Config" } })

		// Click create button to trigger validation
		const createButton = screen.getByText("Create Profile")
		fireEvent.click(createButton)

		// Verify error message
		const dialogContent = getDialogContent()
		const errorMessage = within(dialogContent).getByTestId("error-message")
		expect(errorMessage).toHaveTextContent("A profile with this name already exists")
		expect(mockOnUpsertConfig).not.toHaveBeenCalled()
	})

	it("prevents creating profile with empty name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		// Enter empty name
		const input = screen.getByPlaceholderText("Enter profile name")
		fireEvent.input(input, { target: { value: "   " } })

		// Verify create button is disabled
		const createButton = screen.getByText("Create Profile")
		expect(createButton).toBeDisabled()
		expect(mockOnUpsertConfig).not.toHaveBeenCalled()
	})

	it("allows renaming the current config", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTitle("Rename profile")
		fireEvent.click(renameButton)

		// Find input and enter new name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "New Name" } })

		// Save
		const saveButton = screen.getByTitle("Save")
		fireEvent.click(saveButton)

		expect(mockOnRenameConfig).toHaveBeenCalledWith("Default Config", "New Name")
	})

	it("shows error when renaming to existing config name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTitle("Rename profile")
		fireEvent.click(renameButton)

		// Find input and enter existing name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "Another Config" } })

		// Save to trigger validation
		const saveButton = screen.getByTitle("Save")
		fireEvent.click(saveButton)

		// Verify error message
		const renameForm = getRenameForm()
		const errorMessage = within(renameForm).getByTestId("error-message")
		expect(errorMessage).toHaveTextContent("A profile with this name already exists")
		expect(mockOnRenameConfig).not.toHaveBeenCalled()
	})

	it("prevents renaming to empty name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTitle("Rename profile")
		fireEvent.click(renameButton)

		// Find input and enter empty name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "   " } })

		// Verify save button is disabled
		const saveButton = screen.getByTitle("Save")
		expect(saveButton).toBeDisabled()
		expect(mockOnRenameConfig).not.toHaveBeenCalled()
	})

	it("allows selecting a different config", () => {
		render(<ApiConfigManager {...defaultProps} />)

		const select = screen.getByRole("combobox")
		fireEvent.change(select, { target: { value: "Another Config" } })

		expect(mockOnSelectConfig).toHaveBeenCalledWith("Another Config")
	})

	it("allows deleting the current config when not the only one", () => {
		render(<ApiConfigManager {...defaultProps} />)

		const deleteButton = screen.getByTitle("Delete profile")
		expect(deleteButton).not.toBeDisabled()

		fireEvent.click(deleteButton)
		expect(mockOnDeleteConfig).toHaveBeenCalledWith("Default Config")
	})

	it("disables delete button when only one config exists", () => {
		render(<ApiConfigManager {...defaultProps} listApiConfigMeta={[{ id: "default", name: "Default Config" }]} />)

		const deleteButton = screen.getByTitle("Cannot delete the only profile")
		expect(deleteButton).toHaveAttribute("disabled")
	})

	it("cancels rename operation when clicking cancel", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTitle("Rename profile")
		fireEvent.click(renameButton)

		// Find input and enter new name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "New Name" } })

		// Cancel
		const cancelButton = screen.getByTitle("Cancel")
		fireEvent.click(cancelButton)

		// Verify rename was not called
		expect(mockOnRenameConfig).not.toHaveBeenCalled()

		// Verify we're back to normal view
		expect(screen.queryByDisplayValue("New Name")).not.toBeInTheDocument()
	})

	it("handles keyboard events in new profile dialog", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		const input = screen.getByPlaceholderText("Enter profile name")

		// Test Enter key
		fireEvent.input(input, { target: { value: "New Profile" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(mockOnUpsertConfig).toHaveBeenCalledWith("New Profile")

		// Test Escape key
		fireEvent.keyDown(input, { key: "Escape" })
		expect(screen.getByTestId("dialog")).not.toBeVisible()
	})

	it("handles keyboard events in rename mode", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTitle("Rename profile")
		fireEvent.click(renameButton)

		const input = screen.getByDisplayValue("Default Config")

		// Test Enter key
		fireEvent.input(input, { target: { value: "New Name" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(mockOnRenameConfig).toHaveBeenCalledWith("Default Config", "New Name")

		// Test Escape key
		fireEvent.keyDown(input, { key: "Escape" })
		expect(screen.queryByDisplayValue("New Name")).not.toBeInTheDocument()
	})
})
