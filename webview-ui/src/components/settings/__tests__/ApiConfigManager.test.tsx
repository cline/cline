import { render, screen, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom"
import ApiConfigManager from "../ApiConfigManager"

// Mock VSCode components
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick, title, disabled }: any) => (
		<button onClick={onClick} title={title} disabled={disabled}>
			{children}
		</button>
	),
	VSCodeTextField: ({ value, onInput, placeholder }: any) => (
		<input
			value={value}
			onChange={(e) => onInput(e)}
			placeholder={placeholder}
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

describe("ApiConfigManager", () => {
	const mockOnSelectConfig = jest.fn()
	const mockOnDeleteConfig = jest.fn()
	const mockOnRenameConfig = jest.fn()
	const mockOnUpsertConfig = jest.fn()

	const defaultProps = {
		currentApiConfigName: "Default Config",
		listApiConfigMeta: [{ name: "Default Config" }, { name: "Another Config" }],
		onSelectConfig: mockOnSelectConfig,
		onDeleteConfig: mockOnDeleteConfig,
		onRenameConfig: mockOnRenameConfig,
		onUpsertConfig: mockOnUpsertConfig,
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("immediately creates a copy when clicking add button", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Find and click the add button
		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		// Verify that onUpsertConfig was called with the correct name
		expect(mockOnUpsertConfig).toHaveBeenCalledTimes(1)
		expect(mockOnUpsertConfig).toHaveBeenCalledWith("Default Config (copy)")
	})

	it("creates copy with correct name when current config has spaces", () => {
		render(<ApiConfigManager {...defaultProps} currentApiConfigName="My Test Config" />)

		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		expect(mockOnUpsertConfig).toHaveBeenCalledWith("My Test Config (copy)")
	})

	it("handles empty current config name gracefully", () => {
		render(<ApiConfigManager {...defaultProps} currentApiConfigName="" />)

		const addButton = screen.getByTitle("Add profile")
		fireEvent.click(addButton)

		expect(mockOnUpsertConfig).toHaveBeenCalledWith(" (copy)")
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
		render(<ApiConfigManager {...defaultProps} listApiConfigMeta={[{ name: "Default Config" }]} />)

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
})
