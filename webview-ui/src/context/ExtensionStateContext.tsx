import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage, ExtensionState } from "../../../src/shared/ExtensionMessage"
import { ApiConfiguration } from "../../../src/shared/api"
import { vscode } from "../utils/vscode"
import { convertTextMateToHljs } from "../utils/textMateToHljs"

interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
	theme: any
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
	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "state" && message.state) {
			setState(message.state)
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
		}
		if (message.type === "theme" && message.text) {
			setTheme(convertTextMateToHljs(JSON.parse(message.text)))
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
