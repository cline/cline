import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { OpenAICompatible } from "../OpenAICompatible"
import { ProviderSettings } from "@roo-code/types"

// Mock the vscrui Checkbox component
jest.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange }: any) => (
		<label data-testid={`checkbox-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}>
			<input
				type="checkbox"
				checked={checked}
				onChange={() => onChange(!checked)} // Toggle the checked state
				data-testid={`checkbox-input-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}
			/>
			{children}
		</label>
	),
}))

// Mock the VSCodeTextField and VSCodeButton components
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		children,
		value,
		onInput,
		placeholder,
		className,
		style,
		"data-testid": dataTestId,
		...rest
	}: any) => {
		return (
			<div
				data-testid={dataTestId ? `${dataTestId}-text-field` : "vscode-text-field"}
				className={className}
				style={style}>
				{children}
				<input
					type="text"
					value={value}
					onChange={(e) => onInput && onInput(e)}
					placeholder={placeholder}
					data-testid={dataTestId}
					{...rest}
				/>
			</div>
		)
	},
	VSCodeButton: ({ children, onClick, appearance, title }: any) => (
		<button onClick={onClick} title={title} data-testid={`vscode-button-${appearance}`}>
			{children}
		</button>
	),
}))

// Mock the translation hook
jest.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock the UI components
jest.mock("@src/components/ui", () => ({
	Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}))

// Mock other components
jest.mock("../../ModelPicker", () => ({
	ModelPicker: () => <div data-testid="model-picker">Model Picker</div>,
}))

jest.mock("../../R1FormatSetting", () => ({
	R1FormatSetting: () => <div data-testid="r1-format-setting">R1 Format Setting</div>,
}))

jest.mock("../../ThinkingBudget", () => ({
	ThinkingBudget: () => <div data-testid="thinking-budget">Thinking Budget</div>,
}))

// Mock react-use
jest.mock("react-use", () => ({
	useEvent: jest.fn(),
}))

describe("OpenAICompatible Component - includeMaxTokens checkbox", () => {
	const mockSetApiConfigurationField = jest.fn()
	const mockOrganizationAllowList = {
		allowAll: true,
		providers: {},
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe("Checkbox Rendering", () => {
		it("should render the includeMaxTokens checkbox", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check that the checkbox is rendered
			const checkbox = screen.getByTestId("checkbox-settings:includemaxoutputtokens")
			expect(checkbox).toBeInTheDocument()

			// Check that the description text is rendered
			expect(screen.getByText("settings:includeMaxOutputTokensDescription")).toBeInTheDocument()
		})

		it("should render the checkbox with correct translation keys", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check that the correct translation key is used for the label
			expect(screen.getByText("settings:includeMaxOutputTokens")).toBeInTheDocument()

			// Check that the correct translation key is used for the description
			expect(screen.getByText("settings:includeMaxOutputTokensDescription")).toBeInTheDocument()
		})
	})

	describe("Initial State", () => {
		it("should show checkbox as checked when includeMaxTokens is true", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()
		})

		it("should show checkbox as unchecked when includeMaxTokens is false", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: false,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).not.toBeChecked()
		})

		it("should default to checked when includeMaxTokens is undefined", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				// includeMaxTokens is not defined
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()
		})

		it("should default to checked when includeMaxTokens is null", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: null as any,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()
		})
	})

	describe("User Interaction", () => {
		it("should call handleInputChange with correct parameters when checkbox is clicked from checked to unchecked", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			fireEvent.click(checkboxInput)

			// Verify setApiConfigurationField was called with correct parameters
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("includeMaxTokens", false)
		})

		it("should call handleInputChange with correct parameters when checkbox is clicked from unchecked to checked", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: false,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			fireEvent.click(checkboxInput)

			// Verify setApiConfigurationField was called with correct parameters
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("includeMaxTokens", true)
		})
	})

	describe("Component Updates", () => {
		it("should update checkbox state when apiConfiguration changes", () => {
			const apiConfigurationInitial: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			const { rerender } = render(
				<OpenAICompatible
					apiConfiguration={apiConfigurationInitial as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Verify initial state
			let checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()

			// Update with new configuration
			const apiConfigurationUpdated: Partial<ProviderSettings> = {
				includeMaxTokens: false,
			}

			rerender(
				<OpenAICompatible
					apiConfiguration={apiConfigurationUpdated as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Verify updated state
			checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).not.toBeChecked()
		})
	})

	describe("UI Structure", () => {
		it("should render the checkbox with description in correct structure", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check that the checkbox and description are in a div container
			const checkbox = screen.getByTestId("checkbox-settings:includemaxoutputtokens")
			const parentDiv = checkbox.closest("div")
			expect(parentDiv).toBeInTheDocument()

			// Check that the description has the correct styling classes
			const description = screen.getByText("settings:includeMaxOutputTokensDescription")
			expect(description).toHaveClass("text-sm", "text-vscode-descriptionForeground", "ml-6")
		})
	})
})
