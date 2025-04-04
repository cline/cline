import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "../../../src/shared/AutoApprovalSettings"
import { CustomInstructionMode } from "../../../src/shared/CustomInstructionMode"
import { ExtensionMessage, ExtensionState, DEFAULT_PLATFORM } from "../../../src/shared/ExtensionMessage"
import { ApiConfiguration, ModelInfo, openRouterDefaultModelId, openRouterDefaultModelInfo } from "../../../src/shared/api"
import { findLastIndex } from "../../../src/shared/array"
import { McpMarketplaceCatalog, McpServer } from "../../../src/shared/mcp"
import { convertTextMateToHljs } from "../utils/textMateToHljs"
import { vscode } from "../utils/vscode"
import { DEFAULT_BROWSER_SETTINGS } from "../../../src/shared/BrowserSettings"
import { DEFAULT_CHAT_SETTINGS } from "../../../src/shared/ChatSettings"
import { TelemetrySetting } from "../../../src/shared/TelemetrySetting"

interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
	openRouterModels: Record<string, ModelInfo>
	openAiModels: string[]
	mcpServers: McpServer[]
	mcpMarketplaceCatalog: McpMarketplaceCatalog
	filePaths: string[]
	totalTasksSize: number | null
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setTelemetrySetting: (value: TelemetrySetting) => void
	setShowAnnouncement: (value: boolean) => void
	setPlanActSeparateModelsSetting: (value: boolean) => void
	// Custom instruction modes management
	addCustomInstructionMode: (mode: Omit<CustomInstructionMode, "id">) => void
	updateCustomInstructionMode: (id: string, mode: Partial<Omit<CustomInstructionMode, "id">>) => void
	removeCustomInstructionMode: (id: string) => void
	setSelectedModeIds: (ids: string[]) => void
	toggleModeSelection: (id: string) => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{
	children: React.ReactNode
}> = ({ children }) => {
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
		customInstructionModes: [], // Initialize custom instruction modes
		selectedModeIds: [], // Initialize selected mode IDs
	})
	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [theme, setTheme] = useState<any>(undefined)
	const [filePaths, setFilePaths] = useState<string[]>([])
	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})
	const [totalTasksSize, setTotalTasksSize] = useState<number | null>(null)

	const [openAiModels, setOpenAiModels] = useState<string[]>([])
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])
	const [mcpMarketplaceCatalog, setMcpMarketplaceCatalog] = useState<McpMarketplaceCatalog>({ items: [] })
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		switch (message.type) {
			case "state": {
				setState(message.state!)
				const config = message.state?.apiConfiguration
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

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	const contextValue: ExtensionStateContextType = {
		...state,
		didHydrateState,
		showWelcome,
		theme,
		openRouterModels,
		openAiModels,
		mcpServers,
		mcpMarketplaceCatalog,
		filePaths,
		totalTasksSize,
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
		setShowAnnouncement: (value) =>
			setState((prevState) => ({
				...prevState,
				shouldShowAnnouncement: value,
			})),
		// --- Custom instruction modes management (Local State Only) ---

		// Add Mode
		addCustomInstructionMode: (mode) => {
			let newModes: CustomInstructionMode[] = []
			setState((prevState) => {
				const id = crypto.randomUUID() // Use crypto for better uniqueness
				newModes = [...prevState.customInstructionModes, { id, ...mode }]
				return {
					...prevState,
					customInstructionModes: newModes,
				}
			})
			// Post update back to extension host
			vscode.postMessage({ type: "updateCustomInstructionModes", customInstructionModes: newModes })
		},

		// Update Mode
		updateCustomInstructionMode: (id, mode) => {
			let updatedModes: CustomInstructionMode[] = []
			setState((prevState) => {
				updatedModes = prevState.customInstructionModes.map((m) => (m.id === id ? { ...m, ...mode } : m))
				return {
					...prevState,
					customInstructionModes: updatedModes,
				}
			})
			// Post update back to extension host
			vscode.postMessage({ type: "updateCustomInstructionModes", customInstructionModes: updatedModes })
		},

		// Remove Mode
		removeCustomInstructionMode: (id) => {
			let newModes: CustomInstructionMode[] = []
			let newSelectedIds: string[] = []
			setState((prevState) => {
				newModes = prevState.customInstructionModes.filter((m) => m.id !== id)
				newSelectedIds = prevState.selectedModeIds.filter((modeId) => modeId !== id)
				return {
					...prevState,
					customInstructionModes: newModes,
					selectedModeIds: newSelectedIds,
				}
			})
			// Post updates back to extension host
			vscode.postMessage({ type: "updateCustomInstructionModes", customInstructionModes: newModes })
			vscode.postMessage({ type: "updateSelectedModeIds", selectedModeIds: newSelectedIds })
		},

		// Set Selected Modes
		setSelectedModeIds: (ids) => {
			setState((prevState) => ({
				...prevState,
				selectedModeIds: ids,
			}))
			// Post update back to extension host
			vscode.postMessage({ type: "updateSelectedModeIds", selectedModeIds: ids })
		},

		// Toggle Single Mode Selection
		toggleModeSelection: (id) => {
			let nextSelectedIds: string[] = []
			setState((prevState) => {
				const isSelected = prevState.selectedModeIds.includes(id)
				nextSelectedIds = isSelected
					? prevState.selectedModeIds.filter((modeId) => modeId !== id)
					: [...prevState.selectedModeIds, id]
				return {
					...prevState,
					selectedModeIds: nextSelectedIds,
				}
			})
			// Post update back to extension host
			vscode.postMessage({ type: "updateSelectedModeIds", selectedModeIds: nextSelectedIds })
		},
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
