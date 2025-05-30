// npx jest src/components/settings/__tests__/ApiOptions.test.tsx

import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { type ModelInfo, type ProviderSettings, openAiModelInfoSaneDefaults } from "@roo-code/types"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import ApiOptions, { ApiOptionsProps } from "../ApiOptions"

// Mock VSCode components
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, value, onBlur }: any) => (
		<div>
			{children}
			<input type="text" value={value} onChange={onBlur} />
		</div>
	),
	VSCodeLink: ({ children, href }: any) => <a href={href}>{children}</a>,
	VSCodeRadio: ({ value, checked }: any) => <input type="radio" value={value} checked={checked} />,
	VSCodeRadioGroup: ({ children }: any) => <div>{children}</div>,
	VSCodeButton: ({ children }: any) => <div>{children}</div>,
}))

// Mock other components
jest.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange }: any) => (
		<label data-testid={`checkbox-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				data-testid={`checkbox-input-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}
			/>
			{children}
		</label>
	),
}))

// Mock @shadcn/ui components
jest.mock("@/components/ui", () => ({
	Select: ({ children, value, onValueChange }: any) => (
		<div className="select-mock">
			<select value={value} onChange={(e) => onValueChange && onValueChange(e.target.value)}>
				{children}
			</select>
		</div>
	),
	SelectTrigger: ({ children }: any) => <div className="select-trigger-mock">{children}</div>,
	SelectValue: ({ children }: any) => <div className="select-value-mock">{children}</div>,
	SelectContent: ({ children }: any) => <div className="select-content-mock">{children}</div>,
	SelectItem: ({ children, value }: any) => (
		<option value={value} className="select-item-mock">
			{children}
		</option>
	),
	SelectSeparator: ({ children }: any) => <div className="select-separator-mock">{children}</div>,
	Button: ({ children, onClick, _variant, role, className }: any) => (
		<button onClick={onClick} className={`button-mock ${className || ""}`} role={role}>
			{children}
		</button>
	),
	// Add missing components used by ModelPicker
	Command: ({ children }: any) => <div className="command-mock">{children}</div>,
	CommandEmpty: ({ children }: any) => <div className="command-empty-mock">{children}</div>,
	CommandGroup: ({ children }: any) => <div className="command-group-mock">{children}</div>,
	CommandInput: ({ value, onValueChange, placeholder, className, _ref }: any) => (
		<input
			value={value}
			onChange={(e) => onValueChange && onValueChange(e.target.value)}
			placeholder={placeholder}
			className={className}
		/>
	),
	CommandItem: ({ children, value, onSelect }: any) => (
		<div className="command-item-mock" onClick={() => onSelect && onSelect(value)}>
			{children}
		</div>
	),
	CommandList: ({ children }: any) => <div className="command-list-mock">{children}</div>,
	Popover: ({ children, _open, _onOpenChange }: any) => <div className="popover-mock">{children}</div>,
	PopoverContent: ({ children, _className }: any) => <div className="popover-content-mock">{children}</div>,
	PopoverTrigger: ({ children, _asChild }: any) => <div className="popover-trigger-mock">{children}</div>,
	Slider: ({ value, onChange }: any) => (
		<div data-testid="slider">
			<input type="range" value={value || 0} onChange={(e) => onChange(parseFloat(e.target.value))} />
		</div>
	),
}))

jest.mock("../TemperatureControl", () => ({
	TemperatureControl: ({ value, onChange }: any) => (
		<div data-testid="temperature-control">
			<input
				type="range"
				value={value || 0}
				onChange={(e) => onChange(parseFloat(e.target.value))}
				min={0}
				max={2}
				step={0.1}
			/>
		</div>
	),
}))

jest.mock("../RateLimitSecondsControl", () => ({
	RateLimitSecondsControl: ({ value, onChange }: any) => (
		<div data-testid="rate-limit-seconds-control">
			<input
				type="range"
				value={value || 0}
				onChange={(e) => onChange(parseFloat(e.target.value))}
				min={0}
				max={60}
				step={1}
			/>
		</div>
	),
}))

// Mock DiffSettingsControl for tests
jest.mock("../DiffSettingsControl", () => ({
	DiffSettingsControl: ({ diffEnabled, fuzzyMatchThreshold, onChange }: any) => (
		<div data-testid="diff-settings-control">
			<label>
				Enable editing through diffs
				<input
					type="checkbox"
					checked={diffEnabled}
					onChange={(e) => onChange("diffEnabled", e.target.checked)}
				/>
			</label>
			<div>
				Fuzzy match threshold
				<input
					type="range"
					value={fuzzyMatchThreshold || 1.0}
					onChange={(e) => onChange("fuzzyMatchThreshold", parseFloat(e.target.value))}
					min={0.8}
					max={1}
					step={0.005}
				/>
			</div>
		</div>
	),
}))

// Mock ThinkingBudget component
jest.mock("../ThinkingBudget", () => ({
	ThinkingBudget: ({ modelInfo }: any) => {
		// Only render if model supports reasoning budget (thinking models)
		if (modelInfo?.supportsReasoningBudget || modelInfo?.requiredReasoningBudget) {
			return (
				<div data-testid="reasoning-budget">
					<div>Max Thinking Tokens</div>
					<input type="range" min={1024} max={100000} step={1024} />
				</div>
			)
		}
		return null
	},
}))

// Mock LiteLLM provider for tests
jest.mock("../providers/LiteLLM", () => ({
	LiteLLM: ({ apiConfiguration, setApiConfigurationField }: any) => (
		<div data-testid="litellm-provider">
			<input
				data-testid="litellm-base-url"
				type="text"
				value={apiConfiguration.litellmBaseUrl || ""}
				onChange={(e) => setApiConfigurationField("litellmBaseUrl", e.target.value)}
				placeholder="Base URL"
			/>
			<input
				data-testid="litellm-api-key"
				type="password"
				value={apiConfiguration.litellmApiKey || ""}
				onChange={(e) => setApiConfigurationField("litellmApiKey", e.target.value)}
				placeholder="API Key"
			/>
			<button data-testid="litellm-refresh-models">Refresh Models</button>
		</div>
	),
}))

jest.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: jest.fn((apiConfiguration: ProviderSettings) => {
		if (apiConfiguration.apiModelId?.includes("thinking")) {
			const info: ModelInfo = {
				contextWindow: 4000,
				maxTokens: 128000,
				supportsPromptCache: true,
				requiredReasoningBudget: true,
				supportsReasoningBudget: true,
			}

			return {
				provider: apiConfiguration.apiProvider,
				info,
			}
		} else {
			const info: ModelInfo = { contextWindow: 4000, supportsPromptCache: true }

			return {
				provider: apiConfiguration.apiProvider,
				info,
			}
		}
	}),
}))

const renderApiOptions = (props: Partial<ApiOptionsProps> = {}) => {
	const queryClient = new QueryClient()

	render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ApiOptions
					errorMessage={undefined}
					setErrorMessage={() => {}}
					uriScheme={undefined}
					apiConfiguration={{}}
					setApiConfigurationField={() => {}}
					{...props}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ApiOptions", () => {
	it("shows diff settings, temperature and rate limit controls by default", () => {
		renderApiOptions({
			apiConfiguration: {
				diffEnabled: true,
				fuzzyMatchThreshold: 0.95,
			},
		})
		// Check for DiffSettingsControl by looking for text content
		expect(screen.getByText(/enable editing through diffs/i)).toBeInTheDocument()
		expect(screen.getByTestId("temperature-control")).toBeInTheDocument()
		expect(screen.getByTestId("rate-limit-seconds-control")).toBeInTheDocument()
	})

	it("hides all controls when fromWelcomeView is true", () => {
		renderApiOptions({ fromWelcomeView: true })
		// Check for absence of DiffSettingsControl text
		expect(screen.queryByText(/enable editing through diffs/i)).not.toBeInTheDocument()
		expect(screen.queryByTestId("temperature-control")).not.toBeInTheDocument()
		expect(screen.queryByTestId("rate-limit-seconds-control")).not.toBeInTheDocument()
	})

	describe("thinking functionality", () => {
		it("should show ThinkingBudget for Anthropic models that support thinking", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "anthropic",
					apiModelId: "claude-3-7-sonnet-20250219:thinking",
				},
			})

			expect(screen.getByTestId("reasoning-budget")).toBeInTheDocument()
		})

		it("should show ThinkingBudget for Vertex models that support thinking", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "vertex",
					apiModelId: "claude-3-7-sonnet@20250219:thinking",
				},
			})

			expect(screen.getByTestId("reasoning-budget")).toBeInTheDocument()
		})

		it("should not show ThinkingBudget for models that don't support thinking", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "anthropic",
					apiModelId: "claude-3-opus-20240229",
				},
			})

			expect(screen.queryByTestId("reasoning-budget")).not.toBeInTheDocument()
		})

		// Note: We don't need to test the actual ThinkingBudget component functionality here
		// since we have separate tests for that component. We just need to verify that
		// it's included in the ApiOptions component when appropriate.
	})

	describe("OpenAI provider tests", () => {
		it("removes reasoningEffort from openAiCustomModelInfo when unchecked", () => {
			const mockSetApiConfigurationField = jest.fn()
			const initialConfig = {
				apiProvider: "openai" as const,
				enableReasoningEffort: true,
				openAiCustomModelInfo: {
					...openAiModelInfoSaneDefaults, // Start with defaults
					reasoningEffort: "low" as const, // Set an initial value
				},
				// Add other necessary default fields for openai provider if needed
			}

			renderApiOptions({
				apiConfiguration: initialConfig,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			// Find the checkbox by its test ID instead of label text
			// This is more reliable than using the label text which might be affected by translations
			const checkbox =
				screen.getByTestId("checkbox-input-settings:providers.setreasoninglevel") ||
				screen.getByTestId("checkbox-input-set-reasoning-level")

			// Simulate unchecking the checkbox
			fireEvent.click(checkbox)

			// 1. Check if enableReasoningEffort was set to false
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableReasoningEffort", false)

			// 2. Check if openAiCustomModelInfo was updated
			const updateCall = mockSetApiConfigurationField.mock.calls.find(
				(call) => call[0] === "openAiCustomModelInfo",
			)
			expect(updateCall).toBeDefined()

			// 3. Check if reasoningEffort property is absent in the updated info
			const updatedInfo = updateCall[1]
			expect(updatedInfo).not.toHaveProperty("reasoningEffort")

			// Optional: Check if other properties were preserved (example)
			expect(updatedInfo).toHaveProperty("contextWindow", openAiModelInfoSaneDefaults.contextWindow)
		})

		it("does not render ReasoningEffort component when initially disabled", () => {
			const mockSetApiConfigurationField = jest.fn()
			const initialConfig = {
				apiProvider: "openai" as const,
				enableReasoningEffort: false, // Initially disabled
				openAiCustomModelInfo: {
					...openAiModelInfoSaneDefaults,
				},
			}

			renderApiOptions({
				apiConfiguration: initialConfig,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			// Check that the ReasoningEffort select component is not rendered.
			expect(screen.queryByTestId("reasoning-effort")).not.toBeInTheDocument()
		})

		it("renders ReasoningEffort component and sets flag when checkbox is checked", () => {
			const mockSetApiConfigurationField = jest.fn()
			const initialConfig = {
				apiProvider: "openai" as const,
				enableReasoningEffort: false, // Initially disabled
				openAiCustomModelInfo: {
					...openAiModelInfoSaneDefaults,
				},
			}

			renderApiOptions({
				apiConfiguration: initialConfig,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const checkbox = screen.getByTestId("checkbox-input-settings:providers.setreasoninglevel")

			// Simulate checking the checkbox
			fireEvent.click(checkbox)

			// 1. Check if enableReasoningEffort was set to true
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableReasoningEffort", true)

			// We can't directly test the rendering of the ReasoningEffort component after the state change
			// without a more complex setup involving state management mocks or re-rendering.
			// However, we've tested the state update call.
		})

		it.skip("updates reasoningEffort in openAiCustomModelInfo when select value changes", () => {
			const mockSetApiConfigurationField = jest.fn()
			const initialConfig = {
				apiProvider: "openai" as const,
				enableReasoningEffort: true, // Initially enabled
				openAiCustomModelInfo: {
					...openAiModelInfoSaneDefaults,
					reasoningEffort: "low" as const,
				},
			}

			renderApiOptions({
				apiConfiguration: initialConfig,
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			// Find the reasoning effort select among all comboboxes by its current value
			// const allSelects = screen.getAllByRole("combobox") as HTMLSelectElement[]
			// const reasoningSelect = allSelects.find(
			// 	(el) => el.value === initialConfig.openAiCustomModelInfo.reasoningEffort,
			// )
			// expect(reasoningSelect).toBeDefined()
			const selectContainer = screen.getByTestId("reasoning-effort")
			expect(selectContainer).toBeInTheDocument()

			console.log(selectContainer.querySelector("select")?.value)

			// Simulate changing the reasoning effort to 'high'
			fireEvent.change(selectContainer.querySelector("select")!, { target: { value: "high" } })

			// Check if setApiConfigurationField was called correctly for openAiCustomModelInfo
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith(
				"openAiCustomModelInfo",
				expect.objectContaining({ reasoningEffort: "high" }),
			)

			// Check that other properties were preserved
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith(
				"openAiCustomModelInfo",
				expect.objectContaining({
					contextWindow: openAiModelInfoSaneDefaults.contextWindow,
				}),
			)
		})
	})

	describe("LiteLLM provider tests", () => {
		it("renders LiteLLM component when provider is selected", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "litellm",
					litellmBaseUrl: "http://localhost:4000",
					litellmApiKey: "test-key",
				},
			})

			expect(screen.getByTestId("litellm-provider")).toBeInTheDocument()
			expect(screen.getByTestId("litellm-base-url")).toHaveValue("http://localhost:4000")
			expect(screen.getByTestId("litellm-api-key")).toHaveValue("test-key")
		})

		it("calls setApiConfigurationField when LiteLLM inputs change", () => {
			const mockSetApiConfigurationField = jest.fn()
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "litellm",
				},
				setApiConfigurationField: mockSetApiConfigurationField,
			})

			const baseUrlInput = screen.getByTestId("litellm-base-url")
			const apiKeyInput = screen.getByTestId("litellm-api-key")

			fireEvent.change(baseUrlInput, { target: { value: "http://new-url:8000" } })
			fireEvent.change(apiKeyInput, { target: { value: "new-api-key" } })

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("litellmBaseUrl", "http://new-url:8000")
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("litellmApiKey", "new-api-key")
		})

		it("shows refresh models button for LiteLLM", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "litellm",
					litellmBaseUrl: "http://localhost:4000",
					litellmApiKey: "test-key",
				},
			})

			expect(screen.getByTestId("litellm-refresh-models")).toBeInTheDocument()
		})

		it("does not render LiteLLM component when other provider is selected", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "anthropic",
				},
			})

			expect(screen.queryByTestId("litellm-provider")).not.toBeInTheDocument()
		})
	})
})
