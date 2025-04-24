import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useEvent } from "react-use"
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
import { McpMarketplaceCatalog, McpServer } from "../../../src/shared/mcp"
import { convertTextMateToHljs } from "../utils/textMateToHljs"
import { vscode } from "../utils/vscode"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
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
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setTelemetrySetting: (value: TelemetrySetting) => void
	setShowAnnouncement: (value: boolean) => void
	setPlanActSeparateModelsSetting: (value: boolean) => void
	setMcpServers: (value: McpServer[]) => void
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
		globalClineRulesToggles: {},
		localClineRulesToggles: {},
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
				setState((prevState) => {
					const incoming = message.state!
					// Versioning logic for autoApprovalSettings
					const incomingVersion = incoming.autoApprovalSettings?.version ?? 1
					const currentVersion = prevState.autoApprovalSettings?.version ?? 1
					const shouldUpdateAutoApproval = incomingVersion > currentVersion
					return {
						...incoming,
						autoApprovalSettings: shouldUpdateAutoApproval
							? incoming.autoApprovalSettings
							: prevState.autoApprovalSettings,
					}
				})
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
		requestyModels,
		mcpServers,
		mcpMarketplaceCatalog,
		filePaths,
		totalTasksSize,
		globalClineRulesToggles: state.globalClineRulesToggles || {},
		localClineRulesToggles: state.localClineRulesToggles || {},
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
		setMcpServers: (mcpServers: McpServer[]) => setMcpServers(mcpServers),
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
