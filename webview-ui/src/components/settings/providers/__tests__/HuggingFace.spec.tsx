import React from "react"
import { render, screen } from "@/utils/test-utils"
import { HuggingFace } from "../HuggingFace"
import { ProviderSettings } from "@roo-code/types"

// Mock the VSCodeTextField component
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
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
	VSCodeLink: ({ children, href, onClick }: any) => (
		<a href={href} onClick={onClick} data-testid="vscode-link">
			{children}
		</a>
	),
	VSCodeButton: ({ children, onClick, ...rest }: any) => (
		<button onClick={onClick} data-testid="vscode-button" {...rest}>
			{children}
		</button>
	),
}))

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			// Return the key for testing, but simulate some actual translations
			const translations: Record<string, string> = {
				"settings:providers.getHuggingFaceApiKey": "Get Hugging Face API Key",
				"settings:providers.huggingFaceApiKey": "Hugging Face API Key",
				"settings:providers.huggingFaceModelId": "Model ID",
			}
			return translations[key] || key
		},
	}),
}))

// Mock the UI components
vi.mock("@src/components/ui", () => ({
	Select: ({ children }: any) => <div data-testid="select">{children}</div>,
	SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
	SelectItem: ({ children }: any) => <div data-testid="select-item">{children}</div>,
	SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
	SelectValue: ({ placeholder }: any) => <div data-testid="select-value">{placeholder}</div>,
	SearchableSelect: ({ value, onValueChange, placeholder, children }: any) => (
		<div data-testid="searchable-select">
			<input
				data-testid="searchable-select-input"
				value={value}
				onChange={(e) => onValueChange && onValueChange(e.target.value)}
				placeholder={placeholder}
			/>
			{children}
		</div>
	),
}))

describe("HuggingFace Component", () => {
	const mockSetApiConfigurationField = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should render with internationalized labels", () => {
		const apiConfiguration: Partial<ProviderSettings> = {
			huggingFaceApiKey: "",
			huggingFaceModelId: "",
		}

		render(
			<HuggingFace
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Check that the translated labels are rendered
		expect(screen.getByText("Get Hugging Face API Key")).toBeInTheDocument()
		expect(screen.getByText("Hugging Face API Key")).toBeInTheDocument()
		expect(screen.getByText("Model ID")).toBeInTheDocument()
	})

	it("should render API key input field", () => {
		const apiConfiguration: Partial<ProviderSettings> = {
			huggingFaceApiKey: "test-api-key",
			huggingFaceModelId: "",
		}

		render(
			<HuggingFace
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Check that the API key input is rendered with the correct value
		const apiKeyInput = screen.getByDisplayValue("test-api-key")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("should render model selection components", () => {
		const apiConfiguration: Partial<ProviderSettings> = {
			huggingFaceApiKey: "test-api-key",
			huggingFaceModelId: "test-model",
		}

		render(
			<HuggingFace
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Check that the searchable select component is rendered
		expect(screen.getByTestId("searchable-select")).toBeInTheDocument()
		expect(screen.getByTestId("searchable-select-input")).toBeInTheDocument()
	})

	it("should display the get API key link", () => {
		const apiConfiguration: Partial<ProviderSettings> = {
			huggingFaceApiKey: "",
			huggingFaceModelId: "",
		}

		render(
			<HuggingFace
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Check that the API key button is rendered
		const apiKeyButton = screen.getByTestId("vscode-button")
		expect(apiKeyButton).toBeInTheDocument()
		expect(apiKeyButton).toHaveTextContent("Get Hugging Face API Key")
	})
})
