import { render, fireEvent, screen } from "@testing-library/react"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import AutoApproveMenu from "../AutoApproveMenu"
import { defaultModeSlug, defaultPrompts } from "../../../../../src/shared/modes"
import { experimentDefault } from "../../../../../src/shared/experiments"

// Mock the ExtensionStateContext hook
jest.mock("../../../context/ExtensionStateContext")

const mockUseExtensionState = useExtensionState as jest.MockedFunction<typeof useExtensionState>

describe("AutoApproveMenu", () => {
	const defaultMockState = {
		// Required state properties
		version: "1.0.0",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		allowedCommands: [],
		soundEnabled: false,
		soundVolume: 0.5,
		diffEnabled: false,
		fuzzyMatchThreshold: 1.0,
		preferredLanguage: "English",
		writeDelayMs: 1000,
		browserViewportSize: "900x600",
		screenshotQuality: 75,
		terminalOutputLineLimit: 500,
		mcpEnabled: true,
		requestDelaySeconds: 5,
		rateLimitSeconds: 0,
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		mode: defaultModeSlug,
		customModePrompts: defaultPrompts,
		customSupportPrompts: {},
		enhancementApiConfigId: "",
		didHydrateState: true,
		showWelcome: false,
		theme: {},
		glamaModels: {},
		openRouterModels: {},
		openAiModels: [],
		mcpServers: [],
		filePaths: [],
		experiments: experimentDefault,
		customModes: [],
		enableMcpServerCreation: false,

		// Auto-approve specific properties
		alwaysAllowReadOnly: false,
		alwaysAllowWrite: false,
		alwaysAllowExecute: false,
		alwaysAllowBrowser: false,
		alwaysAllowMcp: false,
		alwaysApproveResubmit: false,
		alwaysAllowModeSwitch: false,
		autoApprovalEnabled: false,

		// Required setter functions
		setApiConfiguration: jest.fn(),
		setCustomInstructions: jest.fn(),
		setAlwaysAllowReadOnly: jest.fn(),
		setAlwaysAllowWrite: jest.fn(),
		setAlwaysAllowExecute: jest.fn(),
		setAlwaysAllowBrowser: jest.fn(),
		setAlwaysAllowMcp: jest.fn(),
		setAlwaysAllowModeSwitch: jest.fn(),
		setShowAnnouncement: jest.fn(),
		setAllowedCommands: jest.fn(),
		setSoundEnabled: jest.fn(),
		setSoundVolume: jest.fn(),
		setDiffEnabled: jest.fn(),
		setBrowserViewportSize: jest.fn(),
		setFuzzyMatchThreshold: jest.fn(),
		setPreferredLanguage: jest.fn(),
		setWriteDelayMs: jest.fn(),
		setScreenshotQuality: jest.fn(),
		setTerminalOutputLineLimit: jest.fn(),
		setMcpEnabled: jest.fn(),
		setAlwaysApproveResubmit: jest.fn(),
		setRequestDelaySeconds: jest.fn(),
		setRateLimitSeconds: jest.fn(),
		setCurrentApiConfigName: jest.fn(),
		setListApiConfigMeta: jest.fn(),
		onUpdateApiConfig: jest.fn(),
		setMode: jest.fn(),
		setCustomModePrompts: jest.fn(),
		setCustomSupportPrompts: jest.fn(),
		setEnhancementApiConfigId: jest.fn(),
		setAutoApprovalEnabled: jest.fn(),
		setExperimentEnabled: jest.fn(),
		handleInputChange: jest.fn(),
		setCustomModes: jest.fn(),
		setEnableMcpServerCreation: jest.fn(),
	}

	beforeEach(() => {
		mockUseExtensionState.mockReturnValue(defaultMockState)
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	it("renders with initial collapsed state", () => {
		render(<AutoApproveMenu />)

		// Check for main checkbox and label
		expect(screen.getByText("Auto-approve:")).toBeInTheDocument()
		expect(screen.getByText("None")).toBeInTheDocument()

		// Verify the menu is collapsed (actions not visible)
		expect(screen.queryByText("Read files and directories")).not.toBeInTheDocument()
	})

	it("expands menu when clicked", () => {
		render(<AutoApproveMenu />)

		// Click to expand
		fireEvent.click(screen.getByText("Auto-approve:"))

		// Verify menu items are visible
		expect(screen.getByText("Read files and directories")).toBeInTheDocument()
		expect(screen.getByText("Edit files")).toBeInTheDocument()
		expect(screen.getByText("Execute approved commands")).toBeInTheDocument()
		expect(screen.getByText("Use the browser")).toBeInTheDocument()
		expect(screen.getByText("Use MCP servers")).toBeInTheDocument()
		expect(screen.getByText("Retry failed requests")).toBeInTheDocument()
	})

	it("toggles main auto-approval checkbox", () => {
		render(<AutoApproveMenu />)

		const mainCheckbox = screen.getByRole("checkbox")
		fireEvent.click(mainCheckbox)

		expect(defaultMockState.setAutoApprovalEnabled).toHaveBeenCalledWith(true)
	})

	it("toggles individual permissions", () => {
		render(<AutoApproveMenu />)

		// Expand menu
		fireEvent.click(screen.getByText("Auto-approve:"))

		// Click read files checkbox
		fireEvent.click(screen.getByText("Read files and directories"))
		expect(defaultMockState.setAlwaysAllowReadOnly).toHaveBeenCalledWith(true)

		// Click edit files checkbox
		fireEvent.click(screen.getByText("Edit files"))
		expect(defaultMockState.setAlwaysAllowWrite).toHaveBeenCalledWith(true)

		// Click execute commands checkbox
		fireEvent.click(screen.getByText("Execute approved commands"))
		expect(defaultMockState.setAlwaysAllowExecute).toHaveBeenCalledWith(true)
	})

	it("displays enabled actions in summary", () => {
		mockUseExtensionState.mockReturnValue({
			...defaultMockState,
			alwaysAllowReadOnly: true,
			alwaysAllowWrite: true,
			autoApprovalEnabled: true,
		})

		render(<AutoApproveMenu />)

		// Check that enabled actions are shown in summary
		expect(screen.getByText("Read, Edit")).toBeInTheDocument()
	})

	it("preserves checkbox states", () => {
		// Mock state with some permissions enabled
		const mockState = {
			...defaultMockState,
			alwaysAllowReadOnly: true,
			alwaysAllowWrite: true,
		}

		// Update mock to return our state
		mockUseExtensionState.mockReturnValue(mockState)

		render(<AutoApproveMenu />)

		// Expand menu
		fireEvent.click(screen.getByText("Auto-approve:"))

		// Verify read and edit checkboxes are checked
		expect(screen.getByLabelText("Read files and directories")).toBeInTheDocument()
		expect(screen.getByLabelText("Edit files")).toBeInTheDocument()

		// Verify the setters haven't been called yet
		expect(mockState.setAlwaysAllowReadOnly).not.toHaveBeenCalled()
		expect(mockState.setAlwaysAllowWrite).not.toHaveBeenCalled()

		// Collapse menu
		fireEvent.click(screen.getByText("Auto-approve:"))

		// Expand again
		fireEvent.click(screen.getByText("Auto-approve:"))

		// Verify checkboxes are still present
		expect(screen.getByLabelText("Read files and directories")).toBeInTheDocument()
		expect(screen.getByLabelText("Edit files")).toBeInTheDocument()

		// Verify the setters still haven't been called
		expect(mockState.setAlwaysAllowReadOnly).not.toHaveBeenCalled()
		expect(mockState.setAlwaysAllowWrite).not.toHaveBeenCalled()
	})
})
