import { create } from "zustand"
import { vscode } from "../utils/vscode"
import { logger } from "../utils/logger"
import { findLastIndex } from "@shared/array"
import { convertTextMateToHljs } from "../utils/textMateToHljs"
import {
	ExtensionMessage,
	ExtensionState,
	DEFAULT_PLATFORM,
	// ApiConfiguration as SharedApiConfiguration, // Will be imported from ../../../src/shared/api
} from "@shared/ExtensionMessage"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import {
	ApiConfiguration,
	ApiConfiguration as SharedApiConfiguration, // Added alias here
	ModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
} from "../../../src/shared/api"
import { McpMarketplaceCatalog, McpServer, McpViewTab } from "../../../src/shared/mcp"
import { TelemetrySetting } from "@shared/TelemetrySetting"
import { ChatSettings } from "@shared/ChatSettings"

// Helper function to check if any API keys are configured
const hasConfiguredApiKeys = (config?: SharedApiConfiguration): boolean => {
	if (!config) return false
	return [
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
	].some((key) => key !== undefined && key !== "")
}

// Helper function for deep equality check
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const areObjectsDeepEqual = (objA: any, objB: any): boolean => {
	return JSON.stringify(objA) === JSON.stringify(objB)
}

// Generic helper to update state if it has changed (used internally by actions)
function updateStateIfChanged<T>(
	currentValue: T,
	newValue: T,
	setter: (value: T) => void, // This would be a partial set from Zustand
	valueName: string,
	comparisonFn: (a: T, b: T) => boolean = (a, b) => !areObjectsDeepEqual(a, b),
): boolean {
	if (comparisonFn(newValue, currentValue)) {
		logger.debug(`[ExtensionStore] ${valueName} changed. Updating.`)
		setter(newValue)
		return true
	}
	logger.debug(`[ExtensionStore] ${valueName} unchanged. Skipping update.`)
	return false
}

export interface ExtensionStoreState extends ExtensionState {
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
	showAnnouncementView: boolean // Renamed from shouldShowAnnouncement to distinguish UI state

	// Actions
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setTelemetrySetting: (value: TelemetrySetting) => void
	setShowAnnouncementView: (value: boolean) => void // For UI element
	setPlanActSeparateModelsSetting: (value: boolean) => void
	setEnableCheckpointsSetting: (value: boolean) => void
	setMcpMarketplaceEnabled: (value: boolean) => void
	setShellIntegrationTimeout: (value: number) => void
	setChatSettings: (value: ChatSettings) => void
	setStoreMcpServers: (value: McpServer[]) => void // Renamed to avoid conflict with state prop
	setGlobalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalClineRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalCursorRulesToggles: (toggles: Record<string, boolean>) => void
	setLocalWindsurfRulesToggles: (toggles: Record<string, boolean>) => void
	setStoreMcpMarketplaceCatalog: (value: McpMarketplaceCatalog) => void // Renamed

	navigateToMcp: (tab?: McpViewTab) => void
	navigateToSettings: () => void
	navigateToHistory: () => void
	navigateToAccount: () => void
	navigateToChat: () => void

	hideSettings: () => void
	hideHistory: () => void
	hideAccount: () => void
	closeMcpView: () => void

	processMessage: (message: ExtensionMessage) => void
	initializeStore: () => void
}

export const useExtensionState = create<ExtensionStoreState>((set, get) => ({
	// Initial State from ExtensionState defaults
	version: "", // Initialized from __INITIAL_DATA__
	vscMachineId: "", // Initialized from __INITIAL_DATA__
	clineMessages: [],
	taskHistory: [],
	shouldShowAnnouncement: false, // This is from ExtensionState, controls if announcement *should* be shown
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
	apiConfiguration: undefined, // Explicitly undefined initially
	customInstructions: undefined, // Explicitly undefined initially
	mcpMarketplaceEnabled: undefined, // Explicitly undefined initially

	// Initial State for additional properties in ExtensionStoreState
	didHydrateState: false,
	showWelcome: false, // Derived, but good to have an initial value
	theme: undefined,
	openRouterModels: { [openRouterDefaultModelId]: openRouterDefaultModelInfo },
	openAiModels: [],
	requestyModels: { [requestyDefaultModelId]: requestyDefaultModelInfo },
	mcpServers: [],
	mcpMarketplaceCatalog: { items: [] },
	filePaths: [],
	totalTasksSize: null,

	// View state initial values
	showMcp: false,
	mcpTab: undefined,
	showSettings: false,
	showHistory: false,
	showAccount: false,
	showAnnouncementView: false, // UI state for whether announcement is *currently* shown

	// Actions
	initializeStore: () => {
		const initialData = (window as any).__INITIAL_DATA__
		if (initialData) {
			logger.debug("[ExtensionStore] Initializing with __INITIAL_DATA__:", initialData)
			set({
				vscMachineId: initialData.vscMachineId,
				version: initialData.extensionVersion,
			})
		} else {
			logger.warn("[ExtensionStore] __INITIAL_DATA__ not found.")
		}
		// Post message to extension that webview is ready
		vscode.postMessage({ type: "webviewDidLaunch" })
	},

	setApiConfiguration: (config) => set({ apiConfiguration: config }),
	setCustomInstructions: (value) => set({ customInstructions: value }),
	setTelemetrySetting: (value) => set({ telemetrySetting: value }),
	setShowAnnouncementView: (value) => set({ showAnnouncementView: value }),
	setPlanActSeparateModelsSetting: (value) => set({ planActSeparateModelsSetting: value }),
	setEnableCheckpointsSetting: (value) => set({ enableCheckpointsSetting: value }),
	setMcpMarketplaceEnabled: (value) => set({ mcpMarketplaceEnabled: value }),
	setShellIntegrationTimeout: (value) => set({ shellIntegrationTimeout: value }),
	setStoreMcpServers: (value) => set({ mcpServers: value }),
	setGlobalClineRulesToggles: (toggles) => set({ globalClineRulesToggles: toggles }),
	setLocalClineRulesToggles: (toggles) => set({ localClineRulesToggles: toggles }),
	setLocalCursorRulesToggles: (toggles) => set({ localCursorRulesToggles: toggles }),
	setLocalWindsurfRulesToggles: (toggles) => set({ localWindsurfRulesToggles: toggles }),
	setStoreMcpMarketplaceCatalog: (value) => set({ mcpMarketplaceCatalog: value }),

	navigateToMcp: (tab) =>
		set({
			showSettings: false,
			showHistory: false,
			showAccount: false,
			mcpTab: tab,
			showMcp: true,
			showAnnouncementView: false,
		}),
	navigateToSettings: () =>
		set({
			showHistory: false,
			showMcp: false,
			mcpTab: undefined,
			showAccount: false,
			showSettings: true,
			showAnnouncementView: false,
		}),
	navigateToHistory: () =>
		set({
			showSettings: false,
			showMcp: false,
			mcpTab: undefined,
			showAccount: false,
			showHistory: true,
			showAnnouncementView: false,
		}),
	navigateToAccount: () =>
		set({
			showSettings: false,
			showMcp: false,
			mcpTab: undefined,
			showHistory: false,
			showAccount: true,
			showAnnouncementView: false,
		}),
	navigateToChat: () =>
		set({
			showSettings: false,
			showMcp: false,
			mcpTab: undefined,
			showHistory: false,
			showAccount: false,
			showAnnouncementView: false,
		}),

	hideSettings: () => set({ showSettings: false }),
	hideHistory: () => set({ showHistory: false }),
	hideAccount: () => set({ showAccount: false }),
	// hideAnnouncement is covered by setShowAnnouncementView or navigating away
	closeMcpView: () => set({ showMcp: false, mcpTab: undefined }),

	setChatSettings: (value) => {
		set({ chatSettings: value })
		const s = get() // get current full state for other settings
		vscode.postMessage({
			type: "updateSettings",
			chatSettings: value,
			apiConfiguration: s.apiConfiguration,
			customInstructionsSetting: s.customInstructions,
			telemetrySetting: s.telemetrySetting,
			planActSeparateModelsSetting: s.planActSeparateModelsSetting,
			enableCheckpointsSetting: s.enableCheckpointsSetting,
			mcpMarketplaceEnabled: s.mcpMarketplaceEnabled,
		})
	},

	processMessage: (message: ExtensionMessage) => {
		const currentState = get() // Get current state for comparisons and updates
		switch (message.type) {
			case "action": {
				switch (message.action!) {
					case "mcpButtonClicked":
						get().navigateToMcp(message.tab)
						break
					case "settingsButtonClicked":
						get().navigateToSettings()
						break
					case "historyButtonClicked":
						get().navigateToHistory()
						break
					case "accountButtonClicked":
						get().navigateToAccount()
						break
					case "chatButtonClicked":
						get().navigateToChat()
						break
				}
				break
			}
			case "state": {
				if (message.state) {
					const stateData = message.state as ExtensionState
					logger.debug("[ExtensionStore] Processing 'state' message. Incoming version:", stateData.version)

					set((prevState) => {
						const newShowWelcomeValue = !hasConfiguredApiKeys(stateData.apiConfiguration)
						const newDidHydrateStateValue = true

						const incomingAutoApprovalVersion = stateData.autoApprovalSettings?.version ?? 1
						const currentAutoApprovalVersion = prevState.autoApprovalSettings?.version ?? 1
						const finalAutoApprovalSettings =
							incomingAutoApprovalVersion >= currentAutoApprovalVersion // Use >= to ensure latest is always taken
								? stateData.autoApprovalSettings
								: prevState.autoApprovalSettings

						// Preserve version and vscMachineId if they were set from __INITIAL_DATA__
						// and are not part of the incoming stateData or are empty in stateData.
						const versionToKeep = prevState.version || stateData.version
						const vscMachineIdToKeep = prevState.vscMachineId || stateData.vscMachineId

						return {
							...prevState, // Start with previous state
							...stateData, // Overlay with all incoming data
							autoApprovalSettings: finalAutoApprovalSettings,
							version: versionToKeep,
							vscMachineId: vscMachineIdToKeep,
							showWelcome: newShowWelcomeValue,
							didHydrateState: newDidHydrateStateValue,
							// Ensure UI view states are not accidentally overridden by a full 'state' message
							// if they are meant to be controlled independently by navigation actions.
							// However, if 'state' message is the source of truth for these, this is fine.
							// For now, assume 'stateData' can overwrite them if it contains them.
						}
					})
				}
				break
			}
			case "theme": {
				if (message.text) {
					try {
						const newThemeObject = convertTextMateToHljs(JSON.parse(message.text))
						if (!areObjectsDeepEqual(currentState.theme, newThemeObject)) {
							set({ theme: newThemeObject })
						}
					} catch (e) {
						logger.error("[ExtensionStore] Error parsing theme message:", e, message.text)
					}
				}
				break
			}
			case "workspaceUpdated": {
				const newFilePaths = message.filePaths ?? []
				if (!areObjectsDeepEqual(currentState.filePaths, newFilePaths)) {
					set({ filePaths: newFilePaths })
				}
				break
			}
			case "partialMessage": {
				const partialMessage = message.partialMessage!
				logger.debug("[ExtensionStore] Processing 'partialMessage'. TS:", partialMessage.ts)
				set((prevState) => {
					const lastIndex = findLastIndex(prevState.clineMessages, (msg) => msg.ts === partialMessage.ts)
					if (lastIndex !== -1) {
						const oldMessage = prevState.clineMessages[lastIndex]
						if (!areObjectsDeepEqual(oldMessage, partialMessage)) {
							logger.debug("[ExtensionStore] Updating message at index:", lastIndex)
							const newClineMessages = [...prevState.clineMessages]
							newClineMessages[lastIndex] = partialMessage
							return { ...prevState, clineMessages: newClineMessages }
						}
						logger.debug("[ExtensionStore] partialMessage content identical. Skipping update.")
					} else {
						logger.debug("[ExtensionStore] partialMessage no matching TS. Skipping update.")
					}
					return prevState // No change
				})
				break
			}
			case "openRouterModels": {
				const updatedModels = message.openRouterModels ?? {}
				const newOpenRouterModels = {
					[openRouterDefaultModelId]: openRouterDefaultModelInfo,
					...updatedModels,
				}
				if (!areObjectsDeepEqual(currentState.openRouterModels, newOpenRouterModels)) {
					set({ openRouterModels: newOpenRouterModels })
				}
				break
			}
			case "openAiModels": {
				const updatedModels = message.openAiModels ?? []
				if (!areObjectsDeepEqual(currentState.openAiModels, updatedModels)) {
					set({ openAiModels: updatedModels })
				}
				break
			}
			case "requestyModels": {
				const updatedModels = message.requestyModels ?? {}
				const newRequestyModels = {
					[requestyDefaultModelId]: requestyDefaultModelInfo,
					...updatedModels,
				}
				if (!areObjectsDeepEqual(currentState.requestyModels, newRequestyModels)) {
					set({ requestyModels: newRequestyModels })
				}
				break
			}
			case "mcpServers": {
				const newMcpServers = message.mcpServers ?? []
				if (!areObjectsDeepEqual(currentState.mcpServers, newMcpServers)) {
					set({ mcpServers: newMcpServers })
				}
				break
			}
			case "mcpMarketplaceCatalog": {
				if (message.mcpMarketplaceCatalog) {
					if (!areObjectsDeepEqual(currentState.mcpMarketplaceCatalog, message.mcpMarketplaceCatalog)) {
						set({ mcpMarketplaceCatalog: message.mcpMarketplaceCatalog })
					}
				}
				break
			}
			case "totalTasksSize": {
				const newTotalTasksSize = message.totalTasksSize ?? null
				if (currentState.totalTasksSize !== newTotalTasksSize) {
					set({ totalTasksSize: newTotalTasksSize })
				}
				break
			}
		}
	},
}))

// Optional: Log when the store is created (runs once)
logger.debug("[ExtensionStore] Zustand store created.")
