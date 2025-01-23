import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ApiConfigMeta, ExtensionMessage, ExtensionState } from "../../../src/shared/ExtensionMessage"
import {
	ApiConfiguration,
	ModelInfo,
	glamaDefaultModelId,
	glamaDefaultModelInfo,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
} from "../../../src/shared/api"
import { vscode } from "../utils/vscode"
import { convertTextMateToHljs } from "../utils/textMateToHljs"
import { findLastIndex } from "../../../src/shared/array"
import { McpServer } from "../../../src/shared/mcp"
import { checkExistKey } from "../../../src/shared/checkExistApiConfig"
import { Mode, CustomModePrompts, defaultModeSlug, defaultPrompts, ModeConfig } from "../../../src/shared/modes"
import { CustomSupportPrompts } from "../../../src/shared/support-prompt"

export interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
	glamaModels: Record<string, ModelInfo>
	openRouterModels: Record<string, ModelInfo>
	openAiModels: string[]
	mcpServers: McpServer[]
	filePaths: string[]
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setAlwaysAllowReadOnly: (value: boolean) => void
	setAlwaysAllowWrite: (value: boolean) => void
	setAlwaysAllowExecute: (value: boolean) => void
	setAlwaysAllowBrowser: (value: boolean) => void
	setAlwaysAllowMcp: (value: boolean) => void
	setShowAnnouncement: (value: boolean) => void
	setAllowedCommands: (value: string[]) => void
	setSoundEnabled: (value: boolean) => void
	setSoundVolume: (value: number) => void
	setDiffEnabled: (value: boolean) => void
	setBrowserViewportSize: (value: string) => void
	setFuzzyMatchThreshold: (value: number) => void
	preferredLanguage: string
	setPreferredLanguage: (value: string) => void
	setWriteDelayMs: (value: number) => void
	screenshotQuality?: number
	setScreenshotQuality: (value: number) => void
	terminalOutputLineLimit?: number
	setTerminalOutputLineLimit: (value: number) => void
	mcpEnabled: boolean
	setMcpEnabled: (value: boolean) => void
	alwaysApproveResubmit?: boolean
	setAlwaysApproveResubmit: (value: boolean) => void
	requestDelaySeconds: number
	setRequestDelaySeconds: (value: number) => void
	setCurrentApiConfigName: (value: string) => void
	setListApiConfigMeta: (value: ApiConfigMeta[]) => void
	onUpdateApiConfig: (apiConfig: ApiConfiguration) => void
	mode: Mode
	setMode: (value: Mode) => void
	setCustomModePrompts: (value: CustomModePrompts) => void
	setCustomSupportPrompts: (value: CustomSupportPrompts) => void
	enhancementApiConfigId?: string
	setEnhancementApiConfigId: (value: string) => void
	experimentalDiffStrategy: boolean
	setExperimentalDiffStrategy: (value: boolean) => void
	autoApprovalEnabled?: boolean
	setAutoApprovalEnabled: (value: boolean) => void
	handleInputChange: (field: keyof ApiConfiguration) => (event: any) => void
	customModes: ModeConfig[]
	setCustomModes: (value: ModeConfig[]) => void
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [state, setState] = useState<ExtensionState>({
		version: "",
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
		alwaysApproveResubmit: false,
		requestDelaySeconds: 5,
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		mode: defaultModeSlug,
		customModePrompts: defaultPrompts,
		customSupportPrompts: {},
		enhancementApiConfigId: "",
		experimentalDiffStrategy: false,
		autoApprovalEnabled: false,
		customModes: [],
	})

	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [theme, setTheme] = useState<any>(undefined)
	const [filePaths, setFilePaths] = useState<string[]>([])
	const [glamaModels, setGlamaModels] = useState<Record<string, ModelInfo>>({
		[glamaDefaultModelId]: glamaDefaultModelInfo,
	})
	const [openRouterModels, setOpenRouterModels] = useState<Record<string, ModelInfo>>({
		[openRouterDefaultModelId]: openRouterDefaultModelInfo,
	})

	const [openAiModels, setOpenAiModels] = useState<string[]>([])
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])

	const setListApiConfigMeta = useCallback(
		(value: ApiConfigMeta[]) => setState((prevState) => ({ ...prevState, listApiConfigMeta: value })),
		[],
	)

	const onUpdateApiConfig = useCallback((apiConfig: ApiConfiguration) => {
		setState((currentState) => {
			vscode.postMessage({
				type: "upsertApiConfiguration",
				text: currentState.currentApiConfigName,
				apiConfiguration: apiConfig,
			})
			return currentState // No state update needed
		})
	}, [])

	const handleInputChange = useCallback(
		(field: keyof ApiConfiguration) => (event: any) => {
			setState((currentState) => {
				vscode.postMessage({
					type: "upsertApiConfiguration",
					text: currentState.currentApiConfigName,
					apiConfiguration: { ...currentState.apiConfiguration, [field]: event.target.value },
				})
				return currentState // No state update needed
			})
		},
		[],
	)

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "state": {
					const newState = message.state!
					setState((prevState) => ({
						...prevState,
						...newState,
					}))
					const config = newState.apiConfiguration
					const hasKey = checkExistKey(config)
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
				case "glamaModels": {
					const updatedModels = message.glamaModels ?? {}
					setGlamaModels({
						[glamaDefaultModelId]: glamaDefaultModelInfo, // in case the extension sent a model list without the default model
						...updatedModels,
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
				case "listApiConfig": {
					setListApiConfigMeta(message.listApiConfig ?? [])
					break
				}
			}
		},
		[setListApiConfigMeta],
	)

	useEvent("message", handleMessage)

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	const contextValue: ExtensionStateContextType = {
		...state,
		didHydrateState,
		showWelcome,
		theme,
		glamaModels,
		openRouterModels,
		openAiModels,
		mcpServers,
		filePaths,
		soundVolume: state.soundVolume,
		fuzzyMatchThreshold: state.fuzzyMatchThreshold,
		writeDelayMs: state.writeDelayMs,
		screenshotQuality: state.screenshotQuality,
		experimentalDiffStrategy: state.experimentalDiffStrategy ?? false,
		setApiConfiguration: (value) =>
			setState((prevState) => ({
				...prevState,
				apiConfiguration: value,
			})),
		setCustomInstructions: (value) => setState((prevState) => ({ ...prevState, customInstructions: value })),
		setAlwaysAllowReadOnly: (value) => setState((prevState) => ({ ...prevState, alwaysAllowReadOnly: value })),
		setAlwaysAllowWrite: (value) => setState((prevState) => ({ ...prevState, alwaysAllowWrite: value })),
		setAlwaysAllowExecute: (value) => setState((prevState) => ({ ...prevState, alwaysAllowExecute: value })),
		setAlwaysAllowBrowser: (value) => setState((prevState) => ({ ...prevState, alwaysAllowBrowser: value })),
		setAlwaysAllowMcp: (value) => setState((prevState) => ({ ...prevState, alwaysAllowMcp: value })),
		setShowAnnouncement: (value) => setState((prevState) => ({ ...prevState, shouldShowAnnouncement: value })),
		setAllowedCommands: (value) => setState((prevState) => ({ ...prevState, allowedCommands: value })),
		setSoundEnabled: (value) => setState((prevState) => ({ ...prevState, soundEnabled: value })),
		setSoundVolume: (value) => setState((prevState) => ({ ...prevState, soundVolume: value })),
		setDiffEnabled: (value) => setState((prevState) => ({ ...prevState, diffEnabled: value })),
		setBrowserViewportSize: (value: string) =>
			setState((prevState) => ({ ...prevState, browserViewportSize: value })),
		setFuzzyMatchThreshold: (value) => setState((prevState) => ({ ...prevState, fuzzyMatchThreshold: value })),
		setPreferredLanguage: (value) => setState((prevState) => ({ ...prevState, preferredLanguage: value })),
		setWriteDelayMs: (value) => setState((prevState) => ({ ...prevState, writeDelayMs: value })),
		setScreenshotQuality: (value) => setState((prevState) => ({ ...prevState, screenshotQuality: value })),
		setTerminalOutputLineLimit: (value) =>
			setState((prevState) => ({ ...prevState, terminalOutputLineLimit: value })),
		setMcpEnabled: (value) => setState((prevState) => ({ ...prevState, mcpEnabled: value })),
		setAlwaysApproveResubmit: (value) => setState((prevState) => ({ ...prevState, alwaysApproveResubmit: value })),
		setRequestDelaySeconds: (value) => setState((prevState) => ({ ...prevState, requestDelaySeconds: value })),
		setCurrentApiConfigName: (value) => setState((prevState) => ({ ...prevState, currentApiConfigName: value })),
		setListApiConfigMeta,
		onUpdateApiConfig,
		setMode: (value: Mode) => setState((prevState) => ({ ...prevState, mode: value })),
		setCustomModePrompts: (value) => setState((prevState) => ({ ...prevState, customModePrompts: value })),
		setCustomSupportPrompts: (value) => setState((prevState) => ({ ...prevState, customSupportPrompts: value })),
		setEnhancementApiConfigId: (value) =>
			setState((prevState) => ({ ...prevState, enhancementApiConfigId: value })),
		setExperimentalDiffStrategy: (value) =>
			setState((prevState) => ({ ...prevState, experimentalDiffStrategy: value })),
		setAutoApprovalEnabled: (value) => setState((prevState) => ({ ...prevState, autoApprovalEnabled: value })),
		handleInputChange,
		setCustomModes: (value) => setState((prevState) => ({ ...prevState, customModes: value })),
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
