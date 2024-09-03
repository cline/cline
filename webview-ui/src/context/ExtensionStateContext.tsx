import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage, ExtensionState } from "../../../src/shared/ExtensionMessage"
import { ApiConfiguration } from "../../../src/shared/api"
import { vscode } from "../utils/vscode"

interface ExtensionStateContextType extends ExtensionState {
	didHydrateState: boolean
	showWelcome: boolean
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
				  ].some((key) => key !== undefined)
				: false
			setShowWelcome(!hasKey)
			setDidHydrateState(true)
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
