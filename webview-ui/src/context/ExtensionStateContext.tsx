import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage, ExtensionState } from "../../../src/shared/ExtensionMessage"
import { ApiConfiguration } from "../../../src/shared/api"
import { vscode } from "../utils/vscode"
import { convertTextMateToHljs } from "../utils/textMateToHljs"
import { findLastIndex } from "../../../src/shared/array"

interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
	filePaths: string[]
	setApiConfiguration: (config: ApiConfiguration) => void
	setCustomInstructions: (value?: string) => void
	setAlwaysAllowReadOnly: (value: boolean) => void
	setShowAnnouncement: (value: boolean) => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export const ExtensionStateContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [state, setState] = useState<ExtensionState>({
		version: "",
		claudeMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
	})
	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [theme, setTheme] = useState<any>(undefined)
	const [filePaths, setFilePaths] = useState<string[]>([])

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
							config.geminiApiKey,
							config.openAiNativeApiKey,
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
					const lastIndex = findLastIndex(prevState.claudeMessages, (msg) => msg.ts === partialMessage.ts)
					if (lastIndex !== -1) {
						const newClaudeMessages = [...prevState.claudeMessages]
						newClaudeMessages[lastIndex] = partialMessage
						return { ...prevState, claudeMessages: newClaudeMessages }
					}
					return prevState
				})
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
		filePaths,
		setApiConfiguration: (value) => setState((prevState) => ({ ...prevState, apiConfiguration: value })),
		setCustomInstructions: (value) => setState((prevState) => ({ ...prevState, customInstructions: value })),
		setAlwaysAllowReadOnly: (value) => setState((prevState) => ({ ...prevState, alwaysAllowReadOnly: value })),
		setShowAnnouncement: (value) => setState((prevState) => ({ ...prevState, shouldShowAnnouncement: value })),
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
