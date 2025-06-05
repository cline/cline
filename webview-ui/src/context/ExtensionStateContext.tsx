import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useEvent } from "react-use"
import { EmptyRequest } from "@shared/proto/common"
import { WebviewProviderType as WebviewProviderTypeEnum, WebviewProviderTypeRequest } from "@shared/proto/ui"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { ChatSettings, DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import { DEFAULT_PLATFORM, ExtensionMessage, ExtensionState } from "@shared/ExtensionMessage"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { findLastIndex } from "@shared/array"
import {
	ApiConfiguration,
	ModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../src/shared/api"
import { McpMarketplaceCatalog, McpServer, McpViewTab } from "../../../src/shared/mcp"
import { ModelsServiceClient, StateServiceClient, UiServiceClient, McpServiceClient } from "../services/grpc-client"
import { convertTextMateToHljs } from "../utils/textMateToHljs"
import { vscode } from "../utils/vscode"

interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	theme: Record<string, string> | undefined
	openRouterModels: Record<string, ModelInfo>
	openAiModels: string[]
	requestyModels: Record<string, ModelInfo>
	mcpServers: McpServer[]
	mcpMarketplaceCatalog: McpMarketplaceCatalog
	filePaths: string[]
	totalTasksSize: number | null

	// View state
	showMcp: boolean
	mcpTab?: McpViewTab
	showSettings: boolean
	showHistory: boolean
	showAccount: boolean
	showAnnouncement: boolean

	// Setters
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setTelemetrySetting: (value: TelemetrySetting) => void
	setShowAnnouncement: (value: boolean) => void
	setShouldShowAnnouncement: (value: boolean) => void
	setPlanActSeparateModelsSetting: (value: boolean) => void
	setEnableCheckpointsSetting: (value: boolean) => void
	setMcpMarketplaceEnabled: (value: boolean) => void
	setShellIntegrationTimeout: (value: number) => void
	setTerminalReuseEnabled: (value: boolean) => void
	setChatSettings: (value: ChatSettings) => void
	setMcpServers: (value: McpServer[]) => void
	setGlobalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalCursorRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWindsurfRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setGlobalWorkflowToggles: (toggles: Record<string, boolean>) => void
	setMcpMarketplaceCatalog: (value: McpMarketplaceCatalog) => void
	setTotalTasksSize: (value: number | null) => void

	// Refresh functions
	refreshOpenRouterModels: () => void

	// Navigation state setters
	setShowMcp: (value: boolean) => void
	setMcpTab: (tab?: McpViewTab) => void

	// Navigation functions
	navigateToMcp: (tab?: McpViewTab) => void
	navigateToSettings: () => void
	navigateToHistory: () => void
	navigateToAccount: () => void
	navigateToChat: () => void

	// Hide functions
	hideSettings: () => void
	hideHistory: () => void
	hideAccount: () => void
	hideAnnouncement: () => void
	closeMcpView: () => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{
	children: React.ReactNode
}> = ({ children }) => {
	// Get the current webview provider type
	const currentProviderType =
		window.WEBVIEW_PROVIDER_TYPE === "sidebar" ? WebviewProviderTypeEnum.SIDEBAR : WebviewProviderTypeEnum.TAB
	// UI view state
	const [showMcp, setShowMcp] = useState(false)
	const [mcpTab, setMcpTab] = useState<McpViewTab | undefined>(undefined)
	const [showSettings, setShowSettings] = useState(false)
	const [showHistory, setShowHistory] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	// Helper for MCP view
	const closeMcpView = useCallback(() => {
		setShowMcp(false)
		setMcpTab(undefined)
	}, [setShowMcp, setMcpTab])

	// Hide functions
	const hideSettings = useCallback(() => setShowSettings(false), [setShowSettings])
	const hideHistory = useCallback(() => setShowHistory(false), [setShowHistory])
	const hideAccount = useCallback(() => setShowAccount(false), [setShowAccount])
	const hideAnnouncement = useCallback(() => setShowAnnouncement(false), [setShowAnnouncement])

	// Navigation functions
	const navigateToMcp = useCallback(
		(tab?: McpViewTab) => {
			setShowSettings(false)
			setShowHistory(false)
			setShowAccount(false)
			if (tab) {
				setMcpTab(tab)
			}
			setShowMcp(true)
		},
		[setShowMcp, setMcpTab, setShowSettings, setShowHistory, setShowAccount],
	)

	const navigateToSettings = useCallback(() => {
		setShowHistory(false)
		closeMcpView()
		setShowAccount(false)
		setShowSettings(true)
	}, [setShowSettings, setShowHistory, closeMcpView, setShowAccount])

	const navigateToHistory = useCallback(() => {
		setShowSettings(false)
		closeMcpView()
		setShowAccount(false)
		setShowHistory(true)
	}, [setShowSettings, closeMcpView, setShowAccount, setShowHistory])

	const navigateToAccount = useCallback(() => {
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(true)
	}, [setShowSettings, closeMcpView, setShowHistory, setShowAccount])

	const navigateToChat = useCallback(() => {
		setShowSettings(false)
		closeMcpView()
		setShowHistory(false)
		setShowAccount(false)
	}, [setShowSettings, closeMcpView, setShowHistory, setShowAccount])

	const [state, setState] = useState<ExtensionState>({
		version: "",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		autoApprovalSettings: DEFAULT_AUTO_APPROVAL_SETTINGS,
		browserSettings: DEFAULT_BROWSER_SETTINGS,
		chatSettings: DEFAULT_CHAT_SETTINGS,
		platform: DEFAULT_PLATFORM,
		telemetrySetting: "unset",
		distinctId: "",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		globalClineRulesToggles: {},
		localClineRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4000, // default timeout for shell integration
		terminalReuseEnabled: true, // default to enabled for backward compatibility
		isNewUser: false,
	})
	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [theme, setTheme] = useState<Record<string, string>>()
	const [filePaths, setFilePaths] = useState<string[]>([])
	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})
	const [totalTasksSize, setTotalTasksSize] = useState<number | null>(null)

	const [openAiModels, setOpenAiModels] = useState<string[]>([])
	const [requestyModels, setRequestyModels] = useState<Record<string, ModelInfo>>({
		[requestyDefaultModelId]: requestyDefaultModelInfo,
	})
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])
	const [mcpMarketplaceCatalog, setMcpMarketplaceCatalog] = useState<McpMarketplaceCatalog>({ items: [] })
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		switch (message.type) {
			case "workspaceUpdated": {
				setFilePaths(message.filePaths ?? [])
				break
			}
			case "openRouterModels": {
				const updatedModels = message.openRouterModels ?? {}
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...updatedModels,
				})
				break
			}
			case "openAiModels": {
				const updatedModels = message.openAiModels ?? []
				setOpenAiModels(updatedModels)
				break
			}
			case "requestyModels": {
				const updatedModels = message.requestyModels ?? {}
				setRequestyModels({
					[requestyDefaultModelId]: requestyDefaultModelInfo,
					...updatedModels,
				})
				break
			}
			case "mcpServers": {
				setMcpServers(message.mcpServers ?? [])
				break
			}
		}
	}, [])

	useEvent("message", handleMessage)

	// References to store subscription cancellation functions
	const stateSubscriptionRef = useRef<(() => void) | null>(null)
	const mcpButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const historyButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const chatButtonUnsubscribeRef = useRef<(() => void) | null>(null)
	const accountButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const settingsButtonClickedSubscriptionRef = useRef<(() => void) | null>(null)
	const partialMessageUnsubscribeRef = useRef<(() => void) | null>(null)
	const mcpMarketplaceUnsubscribeRef = useRef<(() => void) | null>(null)
	const themeSubscriptionRef = useRef<(() => void) | null>(null)

	// Subscribe to state updates and UI events using the gRPC streaming API
	useEffect(() => {
		// Determine the webview provider type
		const webviewType =
			window.WEBVIEW_PROVIDER_TYPE === "sidebar" ? WebviewProviderTypeEnum.SIDEBAR : WebviewProviderTypeEnum.TAB

		// Set up state subscription
		stateSubscriptionRef.current = StateServiceClient.subscribeToState(EmptyRequest.create({}), {
			onResponse: (response) => {
				if (response.stateJson) {
					try {
						const stateData = JSON.parse(response.stateJson) as ExtensionState
						console.log("[DEBUG] parsed state JSON, updating state")
						setState((prevState) => {
							// Versioning logic for autoApprovalSettings
							const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
							const currentVersion = prevState.autoApprovalSettings?.version ?? 1
							const shouldUpdateAutoApproval = incomingVersion > currentVersion

							const newState = {
								...stateData,
								autoApprovalSettings: shouldUpdateAutoApproval
									? stateData.autoApprovalSettings
									: prevState.autoApprovalSettings,
							}

							// Update welcome screen state based on API configuration
							const config = stateData.apiConfiguration
							const hasKey = config
								? [
										config.apiKey,
										config.openRouterApiKey,
										config.awsRegion,
										config.vertexProjectId,
										config.openAiApiKey,
										config.ollamaModelId,
										config.lmStudioModelId,
										config.liteLlmApiKey,
										config.geminiApiKey,
										config.openAiNativeApiKey,
										config.deepSeekApiKey,
										config.requestyApiKey,
										config.togetherApiKey,
										config.qwenApiKey,
										config.doubaoApiKey,
										config.mistralApiKey,
										config.vsCodeLmModelSelector,
										config.clineApiKey,
										config.asksageApiKey,
										config.xaiApiKey,
										config.sambanovaApiKey,
									].some((key) => key !== undefined)
								: false

							setShowWelcome(!hasKey)
							setDidHydrateState(true)

							console.log("[DEBUG] returning new state in ESC")

							return newState
						})
					} catch (error) {
						console.error("Error parsing state JSON:", error)
						console.log("[DEBUG] ERR getting state", error)
					}
				}
				console.log('[DEBUG] ended "got subscribed state"')
			},
			onError: (error) => {
				console.error("Error in state subscription:", error)
			},
			onComplete: () => {
				console.log("State subscription completed")
			},
		})

		// Subscribe to MCP button clicked events with webview type
		mcpButtonUnsubscribeRef.current = UiServiceClient.subscribeToMcpButtonClicked(
			WebviewProviderTypeRequest.create({
				providerType: webviewType,
			}),
			{
				onResponse: () => {
					console.log("[DEBUG] Received mcpButtonClicked event from gRPC stream")
					navigateToMcp()
				},
				onError: (error) => {
					console.error("Error in mcpButtonClicked subscription:", error)
				},
				onComplete: () => {
					console.log("mcpButtonClicked subscription completed")
				},
			},
		)

		// Set up history button clicked subscription with webview type
		historyButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToHistoryButtonClicked(
			WebviewProviderTypeRequest.create({
				providerType: webviewType,
			}),
			{
				onResponse: () => {
					// When history button is clicked, navigate to history view
					console.log("[DEBUG] Received history button clicked event from gRPC stream")
					navigateToHistory()
				},
				onError: (error) => {
					console.error("Error in history button clicked subscription:", error)
				},
				onComplete: () => {
					console.log("History button clicked subscription completed")
				},
			},
		)

		// Subscribe to chat button clicked events with webview type
		chatButtonUnsubscribeRef.current = UiServiceClient.subscribeToChatButtonClicked(EmptyRequest.create({}), {
			onResponse: () => {
				// When chat button is clicked, navigate to chat
				console.log("[DEBUG] Received chat button clicked event from gRPC stream")
				navigateToChat()
			},
			onError: (error) => {
				console.error("Error in chat button subscription:", error)
			},
			onComplete: () => {},
		})

		// Set up settings button clicked subscription
		settingsButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToSettingsButtonClicked(
			WebviewProviderTypeRequest.create({
				providerType: currentProviderType,
			}),
			{
				onResponse: () => {
					// When settings button is clicked, navigate to settings
					navigateToSettings()
				},
				onError: (error) => {
					console.error("Error in settings button clicked subscription:", error)
				},
				onComplete: () => {
					console.log("Settings button clicked subscription completed")
				},
			},
		)

		// Subscribe to partial message events
		partialMessageUnsubscribeRef.current = UiServiceClient.subscribeToPartialMessage(EmptyRequest.create({}), {
			onResponse: (protoMessage) => {
				try {
					console.log("[PARTIAL] Received partialMessage event from gRPC stream")

					// Validate critical fields
					if (!protoMessage.ts || protoMessage.ts <= 0) {
						console.error("Invalid timestamp in partial message:", protoMessage)
						return
					}

					const partialMessage = convertProtoToClineMessage(protoMessage)
					console.log("[PARTIAL] Partial message:", partialMessage)
					console.log("\n")
					setState((prevState) => {
						// worth noting it will never be possible for a more up-to-date message to be sent here or in normal messages post since the presentAssistantContent function uses lock
						const lastIndex = findLastIndex(prevState.clineMessages, (msg) => msg.ts === partialMessage.ts)
						if (lastIndex !== -1) {
							const newClineMessages = [...prevState.clineMessages]
							newClineMessages[lastIndex] = partialMessage
							return { ...prevState, clineMessages: newClineMessages }
						}
						return prevState
					})
				} catch (error) {
					console.error("Failed to process partial message:", error, protoMessage)
				}
			},
			onError: (error) => {
				console.error("Error in partialMessage subscription:", error)
			},
			onComplete: () => {
				console.log("[DEBUG] partialMessage subscription completed")
			},
		})

		// Subscribe to MCP marketplace catalog updates
		mcpMarketplaceUnsubscribeRef.current = McpServiceClient.subscribeToMcpMarketplaceCatalog(EmptyRequest.create({}), {
			onResponse: (catalog) => {
				console.log("[DEBUG] Received MCP marketplace catalog update from gRPC stream")
				setMcpMarketplaceCatalog(catalog)
			},
			onError: (error) => {
				console.error("Error in MCP marketplace catalog subscription:", error)
			},
			onComplete: () => {
				console.log("MCP marketplace catalog subscription completed")
			},
		})

		// Subscribe to theme changes
		themeSubscriptionRef.current = UiServiceClient.subscribeToTheme(EmptyRequest.create({}), {
			onResponse: (response) => {
				if (response.value) {
					try {
						const themeData = JSON.parse(response.value)
						setTheme(convertTextMateToHljs(themeData))
						console.log("[DEBUG] Received theme update from gRPC stream")
					} catch (error) {
						console.error("Error parsing theme data:", error)
					}
				}
			},
			onError: (error) => {
				console.error("Error in theme subscription:", error)
			},
			onComplete: () => {
				console.log("Theme subscription completed")
			},
		})

		// Still send the webviewDidLaunch message for other initialization
		vscode.postMessage({ type: "webviewDidLaunch" })

		// Set up account button clicked subscription
		accountButtonClickedSubscriptionRef.current = UiServiceClient.subscribeToAccountButtonClicked(EmptyRequest.create(), {
			onResponse: () => {
				// When account button is clicked, navigate to account view
				console.log("[DEBUG] Received account button clicked event from gRPC stream")
				navigateToAccount()
			},
			onError: (error) => {
				console.error("Error in account button clicked subscription:", error)
			},
			onComplete: () => {
				console.log("Account button clicked subscription completed")
			},
		})

		// Clean up subscriptions when component unmounts
		return () => {
			if (stateSubscriptionRef.current) {
				stateSubscriptionRef.current()
				stateSubscriptionRef.current = null
			}
			if (mcpButtonUnsubscribeRef.current) {
				mcpButtonUnsubscribeRef.current()
				mcpButtonUnsubscribeRef.current = null
			}
			if (historyButtonClickedSubscriptionRef.current) {
				historyButtonClickedSubscriptionRef.current()
				historyButtonClickedSubscriptionRef.current = null
			}
			if (chatButtonUnsubscribeRef.current) {
				chatButtonUnsubscribeRef.current()
				chatButtonUnsubscribeRef.current = null
			}
			if (accountButtonClickedSubscriptionRef.current) {
				accountButtonClickedSubscriptionRef.current()
				accountButtonClickedSubscriptionRef.current = null
			}
			if (settingsButtonClickedSubscriptionRef.current) {
				settingsButtonClickedSubscriptionRef.current()
				settingsButtonClickedSubscriptionRef.current = null
			}
			if (partialMessageUnsubscribeRef.current) {
				partialMessageUnsubscribeRef.current()
				partialMessageUnsubscribeRef.current = null
			}
			if (mcpMarketplaceUnsubscribeRef.current) {
				mcpMarketplaceUnsubscribeRef.current()
				mcpMarketplaceUnsubscribeRef.current = null
			}
			if (themeSubscriptionRef.current) {
				themeSubscriptionRef.current()
				themeSubscriptionRef.current = null
			}
		}
	}, [])

	const refreshOpenRouterModels = useCallback(() => {
		ModelsServiceClient.refreshOpenRouterModels(EmptyRequest.create({}))
			.then((res) => {
				setOpenRouterModels({
					[openRouterDefaultModelId]: openRouterDefaultModelInfo, // in case the extension sent a model list without the default model
					...res.models,
				})
			})
			.catch((error: Error) => console.error("Failed to refresh OpenRouter models:", error))
	}, [])

	const contextValue: ExtensionStateContextType = {
		...state,
		didHydrateState,
		showWelcome,
		theme,
		openRouterModels,
		openAiModels,
		requestyModels,
		mcpServers,
		mcpMarketplaceCatalog,
		filePaths,
		totalTasksSize,
		showMcp,
		mcpTab,
		showSettings,
		showHistory,
		showAccount,
		showAnnouncement,
		globalClineRulesToggles: state.globalClineRulesToggles || {},
		localClineRulesToggles: state.localClineRulesToggles || {},
		localCursorRulesToggles: state.localCursorRulesToggles || {},
		localWindsurfRulesToggles: state.localWindsurfRulesToggles || {},
		localWorkflowToggles: state.localWorkflowToggles || {},
		globalWorkflowToggles: state.globalWorkflowToggles || {},
		enableCheckpointsSetting: state.enableCheckpointsSetting,

		// Navigation functions
		navigateToMcp,
		navigateToSettings,
		navigateToHistory,
		navigateToAccount,
		navigateToChat,

		// Hide functions
		hideSettings,
		hideHistory,
		hideAccount,
		hideAnnouncement,
		setApiConfiguration: (value) =>
			setState((prevState) => ({
				...prevState,
				apiConfiguration: value,
			})),
		setCustomInstructions: (value) =>
			setState((prevState) => ({
				...prevState,
				customInstructions: value,
			})),
		setTelemetrySetting: (value) =>
			setState((prevState) => ({
				...prevState,
				telemetrySetting: value,
			})),
		setPlanActSeparateModelsSetting: (value) =>
			setState((prevState) => ({
				...prevState,
				planActSeparateModelsSetting: value,
			})),
		setEnableCheckpointsSetting: (value) =>
			setState((prevState) => ({
				...prevState,
				enableCheckpointsSetting: value,
			})),
		setMcpMarketplaceEnabled: (value) =>
			setState((prevState) => ({
				...prevState,
				mcpMarketplaceEnabled: value,
			})),
		setShowAnnouncement,
		setShouldShowAnnouncement: (value) =>
			setState((prevState) => ({
				...prevState,
				shouldShowAnnouncement: value,
			})),
		setShellIntegrationTimeout: (value) =>
			setState((prevState) => ({
				...prevState,
				shellIntegrationTimeout: value,
			})),
		setTerminalReuseEnabled: (value) =>
			setState((prevState) => ({
				...prevState,
				terminalReuseEnabled: value,
			})),
		setMcpServers: (mcpServers: McpServer[]) => setMcpServers(mcpServers),
		setMcpMarketplaceCatalog: (catalog: McpMarketplaceCatalog) => setMcpMarketplaceCatalog(catalog),
		setShowMcp,
		closeMcpView,
		setChatSettings: (value) => {
			setState((prevState) => ({
				...prevState,
				chatSettings: value,
			}))
			vscode.postMessage({
				type: "updateSettings",
				chatSettings: value,
				apiConfiguration: state.apiConfiguration,
				customInstructionsSetting: state.customInstructions,
				telemetrySetting: state.telemetrySetting,
				planActSeparateModelsSetting: state.planActSeparateModelsSetting,
				enableCheckpointsSetting: state.enableCheckpointsSetting,
				mcpMarketplaceEnabled: state.mcpMarketplaceEnabled,
			})
		},
		setGlobalClineRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalClineRulesToggles: toggles,
			})),
		setLocalClineRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localClineRulesToggles: toggles,
			})),
		setLocalCursorRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localCursorRulesToggles: toggles,
			})),
		setLocalWindsurfRulesToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localWindsurfRulesToggles: toggles,
			})),
		setLocalWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				localWorkflowToggles: toggles,
			})),
		setGlobalWorkflowToggles: (toggles) =>
			setState((prevState) => ({
				...prevState,
				globalWorkflowToggles: toggles,
			})),
		setMcpTab,
		setTotalTasksSize,
		refreshOpenRouterModels,
	}

	return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)
	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}
	return context
}
