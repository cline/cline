import { render, screen } from "@/utils/test-utils"
import { HuggingFace } from "../HuggingFace"
import { ProviderSettings } from "@roo-code/types"

// Mock the VSCode components
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
	VSCodeCheckbox: ({ children, checked, onChange, ...rest }: any) => (
		<div data-testid="vscode-checkbox">
			<input
				type="checkbox"
				checked={checked}
				onChange={onChange}
				data-testid="vscode-checkbox-input"
				{...rest}
			/>
			{children}
		</div>
	),
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
				"settings:modelInfo.fetchingModels": "Fetching models...",
				"settings:modelInfo.errorFetchingModels": "Error fetching models",
				"settings:modelInfo.noModelsFound": "No models found",
				"settings:modelInfo.noImages": "Does not support images",
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

// Mock the formatPrice utility
vi.mock("@/utils/formatPrice", () => ({
	formatPrice: (price: number) => `$${price.toFixed(2)}`,
}))

// Create a mock postMessage function
const mockPostMessage = vi.fn()

// Mock the vscode module
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Import the mocked module to set up the spy
import { vscode } from "@src/utils/vscode"

describe("HuggingFace Component", () => {
	const mockSetApiConfigurationField = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		// Set up the mock implementation
		vi.mocked(vscode.postMessage).mockImplementation(mockPostMessage)
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

	it("should fetch models when component mounts", () => {
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

		// Check that the fetch models message was sent
		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "requestHuggingFaceModels",
		})
	})

	it("should display loading state while fetching models", () => {
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

		// Check for loading text in the label
		expect(screen.getByText("settings:providers.huggingFaceLoading")).toBeInTheDocument()
	})

	it("should display model capabilities when a model is selected", async () => {
		const apiConfiguration: Partial<ProviderSettings> = {
			huggingFaceApiKey: "test-api-key",
			huggingFaceModelId: "test-model",
			huggingFaceInferenceProvider: "test-provider", // Select a specific provider to show pricing
		}

		const { rerender } = render(
			<HuggingFace
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Simulate receiving models from the backend
		const mockModels = [
			{
				id: "test-model",
				object: "model",
				created: Date.now(),
				owned_by: "test",
				providers: [
					{
						provider: "test-provider",
						status: "live" as const,
						supports_tools: false,
						supports_structured_output: false,
						context_length: 8192,
						pricing: {
							input: 0.001,
							output: 0.002,
						},
					},
				],
			},
		]

		// Simulate message event
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "huggingFaceModels",
				huggingFaceModels: mockModels,
			},
		})
		window.dispatchEvent(messageEvent)

		// Re-render to trigger effect
		rerender(
			<HuggingFace
				apiConfiguration={apiConfiguration as ProviderSettings}
				setApiConfigurationField={mockSetApiConfigurationField}
			/>,
		)

		// Check that model capabilities are displayed
		expect(screen.getByText("Does not support images")).toBeInTheDocument()
		expect(screen.getByText("8,192 tokens")).toBeInTheDocument()
		// Check that both input and output prices are displayed
		const priceElements = screen.getAllByText("$0.00 / 1M tokens")
		expect(priceElements).toHaveLength(2) // One for input, one for output
	})
})
