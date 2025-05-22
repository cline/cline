import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import ApiOptions from "../ApiOptions"
// Removed import for ExtensionStateProviderWrapper
import { useExtensionState, ExtensionStoreState } from "@/store/extensionStore" // Import store and its type
import { ApiConfiguration } from "@shared/api"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import { DEFAULT_PLATFORM } from "@shared/ExtensionMessage"

const getDefaultMockState = (): Partial<ExtensionStoreState> => ({
	// Provide sensible defaults for all required fields in ExtensionStoreState
	// Based on the initial state in extensionStore.ts
	version: "test-version",
	vscMachineId: "test-machine-id",
	clineMessages: [],
	taskHistory: [],
	shouldShowAnnouncement: false,
	autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
	browserSettings: DEFAULT_BROWSER_SETTINGS,
	chatSettings: DEFAULT_CHAT_SETTINGS,
	platform: DEFAULT_PLATFORM,
	telemetrySetting: "unset",
	planActSeparateModelsSetting: true,
	enableCheckpointsSetting: true,
	globalClineRulesToggles: {},
	localClineRulesToggles: {},
	localCursorRulesToggles: {},
	localWindsurfRulesToggles: {},
	workflowToggles: {},
	shellIntegrationTimeout: 4000,
	isNewUser: false,
	apiConfiguration: {
		apiProvider: "requesty",
		requestyApiKey: "",
		requestyModelId: "",
	},
	customInstructions: undefined,
	mcpMarketplaceEnabled: undefined,
	didHydrateState: true,
	showWelcome: false,
	theme: {},
	openRouterModels: {},
	openAiModels: [],
	requestyModels: {},
	mcpServers: [],
	mcpMarketplaceCatalog: { items: [] },
	filePaths: [],
	totalTasksSize: null,
	showMcp: false,
	mcpTab: undefined,
	showSettings: false,
	showHistory: false,
	showAccount: false,
	showAnnouncementView: false,
	uriScheme: "vscode", // Added from original mock
	// Mock actions as vi.fn()
	setApiConfiguration: vi.fn(),
	setCustomInstructions: vi.fn(),
	setTelemetrySetting: vi.fn(),
	setShowAnnouncementView: vi.fn(),
	setPlanActSeparateModelsSetting: vi.fn(),
	setEnableCheckpointsSetting: vi.fn(),
	setMcpMarketplaceEnabled: vi.fn(),
	setShellIntegrationTimeout: vi.fn(),
	setChatSettings: vi.fn(),
	setStoreMcpServers: vi.fn(),
	setGlobalClineRulesToggles: vi.fn(),
	setLocalClineRulesToggles: vi.fn(),
	setLocalCursorRulesToggles: vi.fn(),
	setLocalWindsurfRulesToggles: vi.fn(),
	setStoreMcpMarketplaceCatalog: vi.fn(),
	navigateToMcp: vi.fn(),
	navigateToSettings: vi.fn(),
	navigateToHistory: vi.fn(),
	navigateToAccount: vi.fn(),
	navigateToChat: vi.fn(),
	hideSettings: vi.fn(),
	hideHistory: vi.fn(),
	hideAccount: vi.fn(),
	closeMcpView: vi.fn(),
	processMessage: vi.fn(),
	initializeStore: vi.fn(),
})

vi.mock("@/store/extensionStore", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual || {}),
		useExtensionState: vi.fn((selector) => {
			const mockState = getDefaultMockState()
			return typeof selector === "function" ? selector(mockState) : mockState
		}),
	}
})

const mockExtensionStoreState = (apiConfig: Partial<ApiConfiguration>) => {
	vi.mocked(useExtensionState).mockImplementation((selector) => {
		const mockState: ExtensionStoreState = {
			...(getDefaultMockState() as ExtensionStoreState), // Cast to ensure all defaults are there
			apiConfiguration: {
				...(getDefaultMockState().apiConfiguration as ApiConfiguration),
				...apiConfig,
			} as ApiConfiguration,
		}
		return typeof selector === "function" ? selector(mockState) : mockState
	})
}

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionStoreState({
			// Changed function name
			apiProvider: "requesty",
		})
	})

	it("renders Requesty API Key input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders Requesty Model ID input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const modelIdInput = screen.getByPlaceholderText("Search and select a model...")
		expect(modelIdInput).toBeInTheDocument()
	})
})

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionStoreState({
			// Changed function name
			apiProvider: "together",
		})
	})

	it("renders Together API Key input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders Together Model ID input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const modelIdInput = screen.getByPlaceholderText("Enter Model ID...")
		expect(modelIdInput).toBeInTheDocument()
	})
})

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }

		mockExtensionStoreState({
			// Changed function name
			apiProvider: "fireworks",
			fireworksApiKey: "",
			fireworksModelId: "",
			fireworksModelMaxCompletionTokens: 2000,
			fireworksModelMaxTokens: 4000,
		})
	})

	it("renders Fireworks API Key input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders Fireworks Model ID input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const modelIdInput = screen.getByPlaceholderText("Enter Model ID...")
		expect(modelIdInput).toBeInTheDocument()
	})

	it("renders Fireworks Max Completion Tokens input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const maxCompletionTokensInput = screen.getByPlaceholderText("2000")
		expect(maxCompletionTokensInput).toBeInTheDocument()
	})

	it("renders Fireworks Max Tokens input", () => {
		render(<ApiOptions showModelOptions={true} />)
		const maxTokensInput = screen.getByPlaceholderText("4000")
		expect(maxTokensInput).toBeInTheDocument()
	})
})

describe("OpenApiInfoOptions", () => {
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionStoreState({
			// Changed function name
			apiProvider: "openai",
		})
	})

	it("renders OpenAI Supports Images input", () => {
		render(<ApiOptions showModelOptions={true} />)
		fireEvent.click(screen.getByText("Model Configuration"))
		const apiKeyInput = screen.getByText("Supports Images")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders OpenAI Context Window Size input", () => {
		render(<ApiOptions showModelOptions={true} />)
		fireEvent.click(screen.getByText("Model Configuration"))
		const orgIdInput = screen.getByText("Context Window Size")
		expect(orgIdInput).toBeInTheDocument()
	})

	it("renders OpenAI Max Output Tokens input", () => {
		render(<ApiOptions showModelOptions={true} />)
		fireEvent.click(screen.getByText("Model Configuration"))
		const modelInput = screen.getByText("Max Output Tokens")
		expect(modelInput).toBeInTheDocument()
	})
})
