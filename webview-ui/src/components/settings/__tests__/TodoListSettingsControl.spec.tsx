import { render, screen, fireEvent } from "@testing-library/react"

import { TodoListSettingsControl } from "../TodoListSettingsControl"

// Mock the translation hook
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"settings:advanced.todoList.label": "Enable todo list tool",
				"settings:advanced.todoList.description":
					"When enabled, Roo can create and manage todo lists to track task progress. This helps organize complex tasks into manageable steps.",
			}
			return translations[key] || key
		},
	}),
}))

// Mock VSCodeCheckbox
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, onChange, checked, ...props }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange({ target: { checked: e.target.checked } })}
				{...props}
			/>
			{children}
		</label>
	),
}))

describe("TodoListSettingsControl", () => {
	it("renders with default props", () => {
		const onChange = vi.fn()
		render(<TodoListSettingsControl onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		const label = screen.getByText("Enable todo list tool")
		const description = screen.getByText(/When enabled, Roo can create and manage todo lists/)

		expect(checkbox).toBeInTheDocument()
		expect(checkbox).toBeChecked() // Default is true
		expect(label).toBeInTheDocument()
		expect(description).toBeInTheDocument()
	})

	it("renders with todoListEnabled set to false", () => {
		const onChange = vi.fn()
		render(<TodoListSettingsControl todoListEnabled={false} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).not.toBeChecked()
	})

	it("calls onChange when checkbox is clicked", () => {
		const onChange = vi.fn()
		render(<TodoListSettingsControl todoListEnabled={true} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(onChange).toHaveBeenCalledWith("todoListEnabled", false)
	})

	it("toggles from unchecked to checked", () => {
		const onChange = vi.fn()
		render(<TodoListSettingsControl todoListEnabled={false} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(onChange).toHaveBeenCalledWith("todoListEnabled", true)
	})
})
