import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "../../../src/shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "../../../src/shared/BrowserSettings"
import { Environment } from "../../../src/shared/config-types"
import { DEFAULT_PLATFORM, type ExtensionState } from "../../../src/shared/ExtensionMessage"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "../../../src/shared/FocusChainSettings"
import { DEFAULT_MCP_DISPLAY_MODE } from "../../../src/shared/McpDisplayMode"
import { ExtensionStateContextProvider, useExtensionState } from "./ExtensionStateContext"

const grpcClientMocks = vi.hoisted(() => ({
	subscribeToStateMock: vi.fn(),
	initializeWebviewMock: vi.fn(),
	genericStreamSubscriptionMock: vi.fn(),
	getAvailableTerminalProfilesMock: vi.fn(),
	modelsClientMock: {
		subscribeToOpenRouterModels: vi.fn(),
		subscribeToLiteLlmModels: vi.fn(),
		refreshOpenRouterModelsRpc: vi.fn(),
		refreshVercelAiGatewayModelsRpc: vi.fn(),
		refreshLiteLlmModelsRpc: vi.fn(),
		refreshClineModelsRpc: vi.fn(),
		refreshHicapModels: vi.fn(),
		refreshBasetenModelsRpc: vi.fn(),
	},
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		subscribeToState: grpcClientMocks.subscribeToStateMock,
		getAvailableTerminalProfiles: grpcClientMocks.getAvailableTerminalProfilesMock,
	},
	UiServiceClient: {
		subscribeToMcpButtonClicked: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToHistoryButtonClicked: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToChatButtonClicked: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToSettingsButtonClicked: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToWorktreesButtonClicked: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToPartialMessage: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToAccountButtonClicked: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToRelinquishControl: grpcClientMocks.genericStreamSubscriptionMock,
		initializeWebview: grpcClientMocks.initializeWebviewMock,
	},
	McpServiceClient: {
		subscribeToMcpServers: grpcClientMocks.genericStreamSubscriptionMock,
		subscribeToMcpMarketplaceCatalog: grpcClientMocks.genericStreamSubscriptionMock,
	},
	ModelsServiceClient: grpcClientMocks.modelsClientMock,
}))

const {
	subscribeToStateMock,
	initializeWebviewMock,
	genericStreamSubscriptionMock,
	getAvailableTerminalProfilesMock,
	modelsClientMock,
} = grpcClientMocks

function createBaseState(overrides: Partial<ExtensionState> = {}): ExtensionState {
	return {
		version: "test-version",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
		browserSettings: DEFAULT_BROWSER_SETTINGS,
		focusChainSettings: DEFAULT_FOCUS_CHAIN_SETTINGS,
		preferredLanguage: "English",
		mode: "act",
		platform: DEFAULT_PLATFORM,
		environment: Environment.production,
		telemetrySetting: "unset",
		distinctId: "distinct-id",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		mcpDisplayMode: DEFAULT_MCP_DISPLAY_MODE,
		globalClineRulesToggles: {},
		localClineRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localAgentsRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		terminalOutputLineLimit: 500,
		maxConsecutiveMistakes: 3,
		defaultTerminalProfile: "default",
		isNewUser: false,
		welcomeViewCompleted: true,
		onboardingModels: undefined,
		mcpResponsesCollapsed: false,
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		customPrompt: undefined,
		useAutoCondense: false,
		subagentsEnabled: false,
		clineWebToolsEnabled: { user: true, featureFlag: false },
		worktreesEnabled: { user: true, featureFlag: false },
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 0,
		lastDismissedModelBannerVersion: 0,
		lastDismissedCliBannerVersion: 0,
		optOutOfRemoteConfig: false,
		remoteConfigSettings: {},
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		backgroundEditEnabled: false,
		doubleCheckCompletionEnabled: false,
		lazyTeammateModeEnabled: false,
		showFeatureTips: true,
		globalSkillsToggles: {},
		localSkillsToggles: {},
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		hooksEnabled: false,
		nativeToolCallSetting: false,
		enableParallelToolCalling: false,
		...overrides,
	}
}

function flushPromises() {
	return act(async () => {
		await Promise.resolve()
		await Promise.resolve()
	})
}

const Harness = () => {
	const { didHydrateState, webviewBootstrapAttempt, webviewBootstrapError, webviewBootstrapStatus, retryWebviewBootstrap } =
		useExtensionState()

	return (
		<div>
			<div data-testid="status">{webviewBootstrapStatus}</div>
			<div data-testid="hydrated">{String(didHydrateState)}</div>
			<div data-testid="attempt">{webviewBootstrapAttempt}</div>
			<div data-testid="error">{webviewBootstrapError ?? ""}</div>
			<button onClick={retryWebviewBootstrap} type="button">
				Retry bootstrap
			</button>
		</div>
	)
}

describe("ExtensionStateContext grey-screen regression coverage", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		subscribeToStateMock.mockReset()
		initializeWebviewMock.mockReset()
		genericStreamSubscriptionMock.mockReset()
		getAvailableTerminalProfilesMock.mockReset()

		subscribeToStateMock.mockImplementation(() => vi.fn())
		initializeWebviewMock.mockResolvedValue({})
		genericStreamSubscriptionMock.mockImplementation(() => vi.fn())
		getAvailableTerminalProfilesMock.mockResolvedValue({ profiles: [] })

		for (const fn of Object.values(modelsClientMock)) {
			fn.mockReset()
		}

		modelsClientMock.subscribeToOpenRouterModels.mockImplementation(() => vi.fn())
		modelsClientMock.subscribeToLiteLlmModels.mockImplementation(() => vi.fn())
		modelsClientMock.refreshOpenRouterModelsRpc.mockResolvedValue({ models: {} })
		modelsClientMock.refreshVercelAiGatewayModelsRpc.mockResolvedValue({ models: {} })
		modelsClientMock.refreshLiteLlmModelsRpc.mockResolvedValue({ models: {} })
		modelsClientMock.refreshClineModelsRpc.mockResolvedValue({ models: {} })
		modelsClientMock.refreshHicapModels.mockResolvedValue({ models: {} })
		modelsClientMock.refreshBasetenModelsRpc.mockResolvedValue({ models: {} })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("transitions to degraded instead of hanging forever when initial state never arrives", async () => {
		render(
			<ExtensionStateContextProvider>
				<Harness />
			</ExtensionStateContextProvider>,
		)

		await flushPromises()
		expect(screen.getByTestId("status").textContent).toBe("hydrating")

		act(() => {
			vi.advanceTimersByTime(8000)
		})
		await flushPromises()

		expect(screen.getByTestId("status").textContent).toBe("degraded")
		expect(screen.getByTestId("hydrated").textContent).toBe("false")
		expect(screen.getByTestId("error").textContent).toContain("Timed out waiting for the initial Cline state")
	})

	it("shows a degraded state when the initial state payload is malformed", async () => {
		render(
			<ExtensionStateContextProvider>
				<Harness />
			</ExtensionStateContextProvider>,
		)

		await flushPromises()
		const callbacks = subscribeToStateMock.mock.calls[0]?.[1]
		expect(callbacks).toBeTruthy()

		await act(async () => {
			callbacks.onResponse({ stateJson: "{" })
		})
		await flushPromises()

		expect(screen.getByTestId("status").textContent).toBe("degraded")
		expect(screen.getByTestId("error").textContent).toContain("Received invalid initial state payload")
	})

	it("recovers after a manual retry when a later state payload succeeds", async () => {
		render(
			<ExtensionStateContextProvider>
				<Harness />
			</ExtensionStateContextProvider>,
		)

		await flushPromises()
		const firstCallbacks = subscribeToStateMock.mock.calls[0]?.[1]

		await act(async () => {
			firstCallbacks.onResponse({ stateJson: "{" })
		})
		await flushPromises()

		fireEvent.click(screen.getByRole("button", { name: "Retry bootstrap" }))
		await flushPromises()

		expect(subscribeToStateMock).toHaveBeenCalledTimes(2)
		const secondCallbacks = subscribeToStateMock.mock.calls[1]?.[1]

		await act(async () => {
			secondCallbacks.onResponse({ stateJson: JSON.stringify(createBaseState()) })
		})
		await flushPromises()

		expect(screen.getByTestId("status").textContent).toBe("hydrated")
		expect(screen.getByTestId("hydrated").textContent).toBe("true")
		expect(screen.getByTestId("attempt").textContent).toBe("2")
	})
})
