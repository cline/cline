import React, { createContext, useCallback, useContext, useEffect, useState, useRef } from "react"
import { useEvent } from "react-use"
import { StateServiceClient } from "../services/grpc-client"
import { EmptyRequest } from "@shared/proto/common"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ExtensionMessage, ExtensionState, DEFAULT_PLATFORM } from "@shared/ExtensionMessage"
import {
	ApiConfiguration,
	ModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../src/shared/api"
import { findLastIndex } from "@shared/array"
import { McpMarketplaceCatalog, McpServer, McpViewTab } from "../../../src/shared/mcp"
import { convertTextMateToHljs } from "../utils/textMateToHljs"
import { vscode } from "../utils/vscode"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { ChatSettings, DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import { TelemetrySetting } from "@shared/TelemetrySetting"

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

	// Setters
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setTelemetrySetting: (value: TelemetrySetting) => void
	setShowAnnouncement: (value: boolean) => void
	setPlanActSeparateModelsSetting: (value: boolean) => void
	setEnableCheckpointsSetting: (value: boolean) => void
	setMcpMarketplaceEnabled: (value: boolean) => void
	setShellIntegrationTimeout: (value: number) => void
	setChatSettings: (value: ChatSettings) => void
	setMcpServers: (value: McpServer[]) => void

	// Navigation
	setShowMcp: (value: boolean) => void
	setMcpTab: (tab?: McpViewTab) => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{
	children: React.ReactNode
}> = ({ children }) => {
	// UI view state
	const [showMcp, setShowMcp] = useState(false)
	const [mcpTab, setMcpTab] = useState<McpViewTab | undefined>(undefined)

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
		vscMachineId: "",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		globalClineRulesToggles: {},
		localClineRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		workflowToggles: {},
		shellIntegrationTimeout: 4000, // default timeout for shell integration
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
			case "state": {
				// Handler for direct state messages
				if (message.state) {
					const stateData = message.state as ExtensionState
					console.log("[Webview Context Test Revert] Received direct 'state' message, updating state.")
					setState((prevState) => {
						// Versioning logic for autoApprovalSettings (copied from original onResponse)
						const incomingVersion = stateData.autoApprovalSettings?.version ?? 1
						const currentVersion = prevState.autoApprovalSettings?.version ?? 1
						const shouldUpdateAutoApproval = incomingVersion > currentVersion

						const newState = {
							...stateData,
							autoApprovalSettings: shouldUpdateAutoApproval
								? stateData.autoApprovalSettings
								: prevState.autoApprovalSettings,
						}

						// Update welcome screen state based on API configuration (copied from original onResponse)
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
						return newState
					})
				}
				break
			}
			case "theme": {
				if (message.text) {
					setTheme(convertTextMateToHljs(JSON.parse(message.text)))
				}
				break
			}
			case "workspaceUpdated": {
				setFilePaths(message.filePaths ?? [])
				break
			}
			case "partialMessage": {
				const partialMessage = message.partialMessage!
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
			case "mcpMarketplaceCatalog": {
				if (message.mcpMarketplaceCatalog) {
					setMcpMarketplaceCatalog(message.mcpMarketplaceCatalog)
				}
				break
			}
			case "totalTasksSize": {
				setTotalTasksSize(message.totalTasksSize ?? null)
				break
			}
		}
	}, [])

	useEvent("message", handleMessage)

	// Reference to store the state subscription cancellation function
	const stateSubscriptionRef = useRef<(() => void) | null>(null)

	// Subscribe to state updates using the new gRPC streaming API
	/* // TEST REVERT: Commenting out gRPC state subscription
	useEffect(() => {
		// Set up state subscription
		stateSubscriptionRef.current = StateServiceClient.subscribeToState(
			{},
			{
				onResponse: (response) => {
					console.log("[DEBUG] got state update via subscription", response);
					if (response.stateJson) {
						try {
							const stateData = JSON.parse(response.stateJson) as ExtensionState;
							console.log("[DEBUG] parsed state JSON, updating state");
							setState((prevState) => {
								// Versioning logic for autoApprovalSettings
								const incomingVersion = stateData.autoApprovalSettings?.version ?? 1;
								const currentVersion = prevState.autoApprovalSettings?.version ?? 1;
								const shouldUpdateAutoApproval = incomingVersion > currentVersion;

								const newState = {
									...stateData,
									autoApprovalSettings: shouldUpdateAutoApproval
										? stateData.autoApprovalSettings
										: prevState.autoApprovalSettings,
								};

								// Update welcome screen state based on API configuration
								const config = stateData.apiConfiguration;
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
									: false;

								setShowWelcome(!hasKey);
								setDidHydrateState(true);

								console.log("[DEBUG] returning new state in ESC");

								return newState;
							});
						} catch (error) {
							console.error("Error parsing state JSON:", error);
							console.log("[DEBUG] ERR getting state", error);
						}
					}
					console.log('[DEBUG] ended "got subscribed state"');
				},
				onError: (error) => {
					console.error("Error in state subscription:", error);
				},
				onComplete: () => {
					console.log("State subscription completed");
				},
			},
		);

		// Still send the webviewDidLaunch message for other initialization
		vscode.postMessage({ type: "webviewDidLaunch" });

		// Clean up subscription when component unmounts
		return () => {
			if (stateSubscriptionRef.current) {
				stateSubscriptionRef.current();
				stateSubscriptionRef.current = null;
			}
		};
	}, []);
	*/ // END TEST REVERT

	// For the test revert, ensure webviewDidLaunch is still sent if not done by the above useEffect
	useEffect(() => {
		// This effect now only sends webviewDidLaunch if the gRPC subscription is commented out.
		// If the gRPC subscription is active, it sends webviewDidLaunch.
		// To avoid sending it twice if you uncomment the above, you might add a flag.
		// For this specific test (gRPC sub commented out), this is fine.
		console.log("[Webview Context Test Revert] Sending webviewDidLaunch from separate useEffect.")
		vscode.postMessage({ type: "webviewDidLaunch" })
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
		globalClineRulesToggles: state.globalClineRulesToggles || {},
		localClineRulesToggles: state.localClineRulesToggles || {},
		localCursorRulesToggles: state.localCursorRulesToggles || {},
		localWindsurfRulesToggles: state.localWindsurfRulesToggles || {},
		workflowToggles: state.workflowToggles || {},
		enableCheckpointsSetting: state.enableCheckpointsSetting,
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
		setShowAnnouncement: (value) =>
			setState((prevState) => ({
				...prevState,
				shouldShowAnnouncement: value,
			})),
		setShellIntegrationTimeout: (value) =>
			setState((prevState) => ({
				...prevState,
				shellIntegrationTimeout: value,
			})),
		setMcpServers: (mcpServers: McpServer[]) => setMcpServers(mcpServers),
		setShowMcp,
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
		setMcpTab,
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
