import React from "react"
import { render, screen, fireEvent, act, within } from "@testing-library/react"
import { describe, test, expect, beforeEach, vi } from "vitest"
import "@testing-library/jest-dom"
import OpenRouterModelPicker from "./OpenRouterModelPicker"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"
import { ExtensionState, ExtensionMessage } from "@shared/ExtensionMessage"
import { ApiConfiguration } from "@shared/api"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import { vscode } from "@/utils/vscode"

// Create a type that includes the state and setter functions
interface MockExtensionStateType extends ExtensionState {
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setTelemetrySetting: (value: string) => void
	setShowAnnouncement: (value: boolean) => void
	setPlanActSeparateModelsSetting: (value: boolean) => void
	openRouterModels: Record<string, any>
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
	openAiModels: string[]
	mcpServers: any[]
	mcpMarketplaceCatalog: { items: any[] }
	filePaths: string[]
	totalTasksSize: number | null
}

// Mocks must be at the top level
vi.mock("styled-components", () => ({
	default: new Proxy(
		{},
		{
			get: (_, prop) => {
				return ({ children, ...props }: any) => {
					const Element = prop as keyof JSX.IntrinsicElements
					return React.createElement(Element, props, children)
				}
			},
		},
	),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => children,
	useExtensionState: () => mockContextValue,
	__esModule: true,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, id, value, onInput }: any) => (
		<div data-testid="vscode-text-field">
			<input id={id} value={value || ""} onChange={(e) => onInput?.(e)} data-testid="model-search-input" role="searchbox" />
			{children}
		</div>
	),
	VSCodeLink: ({ children, onClick }: any) => (
		<a onClick={onClick} data-testid="vscode-link">
			{children}
		</a>
	),
}))

// Store mock context value for the hook to access
let mockContextValue: MockExtensionStateType

const mockModels = {
	"model1/test": { name: "Model 1" },
	"model2/test": { name: "Model 2" },
	"model3/test": { name: "Model 3" },
}

const defaultApiConfiguration: ApiConfiguration = {
	apiProvider: "openrouter",
	openRouterModelId: "model1/test",
	favoritedModelIds: [] as string[],
}

describe("OpenRouterModelPicker Favorites", () => {
	const mockSetApiConfiguration = vi.fn()

	const renderComponent = (favoritedModelIds: string[] = []) => {
		mockContextValue = {
			apiConfiguration: {
				...defaultApiConfiguration,
				favoritedModelIds,
			},
			setApiConfiguration: mockSetApiConfiguration,
			openRouterModels: mockModels,
			didHydrateState: true,
			showWelcome: false,
			theme: {},
			openAiModels: [],
			mcpServers: [],
			mcpMarketplaceCatalog: { items: [] },
			filePaths: [],
			totalTasksSize: null,
			version: "1.0.0",
			clineMessages: [],
			taskHistory: [],
			shouldShowAnnouncement: false,
			autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
			browserSettings: DEFAULT_BROWSER_SETTINGS,
			chatSettings: DEFAULT_CHAT_SETTINGS,
			platform: "darwin",
			telemetrySetting: "unset",
			vscMachineId: "",
			planActSeparateModelsSetting: true,
			setCustomInstructions: () => {},
			setTelemetrySetting: () => {},
			setShowAnnouncement: () => {},
			setPlanActSeparateModelsSetting: () => {},
		}

		return render(<OpenRouterModelPicker />)
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	test("favoriting a model sends correct message and moves model to top", async () => {
		renderComponent()

		// Open dropdown
		const searchInput = screen.getByRole("searchbox")
		await act(async () => {
			fireEvent.focus(searchInput)
		})

		// Wait for dropdown to appear
		const dropdownList = await screen.findByTestId("dropdown-list")
		expect(dropdownList).toBeInTheDocument()

		// Find model2 item and its star icon
		let dropdownItems = screen.getAllByTestId("dropdown-item")
		const model2Item = dropdownItems[1] // Second item since they're sorted alphabetically
		const starIcon = within(model2Item).getByTestId("star-icon")
		await act(async () => {
			fireEvent.click(starIcon)
		})

		// Verify postMessage was called with correct arguments
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "toggleFavoriteModel",
			modelId: "model2/test",
		})

		// Re-render with updated favorites to verify order
		renderComponent(["model2/test"])

		// Get all model items and verify order
		dropdownItems = screen.getAllByTestId("dropdown-item")
		expect(dropdownItems[0].textContent).toContain("model2/test")
	})

	test("unfavoriting a model removes it from top section", async () => {
		// Initial render with model2 favorited
		renderComponent(["model2/test"])

		// Open dropdown
		const searchInput = screen.getByRole("searchbox")
		await act(async () => {
			fireEvent.focus(searchInput)
		})

		// Wait for dropdown to appear
		const dropdownList = await screen.findByTestId("dropdown-list")
		expect(dropdownList).toBeInTheDocument()

		// Find model2 item and its star icon
		let dropdownItems = screen.getAllByTestId("dropdown-item")
		const model2Item = dropdownItems[0] // First item since it's favorited
		const starIcon = within(model2Item).getByTestId("star-icon")
		await act(async () => {
			fireEvent.click(starIcon)
		})

		// Verify postMessage was called with correct arguments
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "toggleFavoriteModel",
			modelId: "model2/test",
		})

		// Re-render with updated favorites to verify order
		renderComponent([])

		// Get all model items and verify order
		dropdownItems = screen.getAllByTestId("dropdown-item")
		expect(dropdownItems[0].textContent).not.toContain("model2/test")
		expect(dropdownItems[1].textContent).toContain("model2/test")
	})
})
