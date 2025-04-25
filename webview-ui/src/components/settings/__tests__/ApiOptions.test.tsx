// npx jest src/components/settings/__tests__/ApiOptions.test.ts

import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ApiConfiguration } from "@roo/shared/api"

import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

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
		<label>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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
	Button: ({ children, onClick }: any) => (
		<button onClick={onClick} className="button-mock">
			{children}
		</button>
	),
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

jest.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: jest.fn((apiConfiguration: ApiConfiguration) => {
		if (apiConfiguration.apiModelId?.includes("thinking")) {
			return {
				provider: apiConfiguration.apiProvider,
				info: { thinking: true, contextWindow: 4000, maxTokens: 128000 },
			}
		} else {
			return {
				provider: apiConfiguration.apiProvider,
				info: { contextWindow: 4000 },
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

			expect(screen.getByTestId("thinking-budget")).toBeInTheDocument()
		})

		it("should show ThinkingBudget for Vertex models that support thinking", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "vertex",
					apiModelId: "claude-3-7-sonnet@20250219:thinking",
				},
			})

			expect(screen.getByTestId("thinking-budget")).toBeInTheDocument()
		})

		it("should not show ThinkingBudget for models that don't support thinking", () => {
			renderApiOptions({
				apiConfiguration: {
					apiProvider: "anthropic",
					apiModelId: "claude-3-opus-20240229",
				},
			})

			expect(screen.queryByTestId("thinking-budget")).not.toBeInTheDocument()
		})

		// Note: We don't need to test the actual ThinkingBudget component functionality here
		// since we have separate tests for that component. We just need to verify that
		// it's included in the ApiOptions component when appropriate.
	})
})
