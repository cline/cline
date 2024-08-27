import React, { createContext, useCallback, useContext, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage, ExtensionState } from "../../../src/shared/ExtensionMessage"
import { ApiConfiguration } from "../../../src/shared/api"
import { vscode } from "../utils/vscode"

interface ExtensionStateContextType extends ExtensionState {
	setApiConfiguration: (config: ApiConfiguration) => void
	setMaxRequestsPerTask: (value?: number) => void
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
		shouldShowKoduPromo: false,
	})
	const [didHydrateState, setDidHydrateState] = useState(false)

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		if (message.type === "state" && message.state) {
			setState(message.state)
			setDidHydrateState(true)
		}
		if (message.type === "action" && message.action) {
			switch (message.action) {
				case "koduCreditsFetched":
					// special case where we only want to update one part of state in case user is in the middle of modifying settings
					setState((prevState) => ({ ...prevState, koduCredits: message.state?.koduCredits }))
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
		setApiConfiguration: (value) => setState((prevState) => ({ ...prevState, apiConfiguration: value })),
		setMaxRequestsPerTask: (value) => setState((prevState) => ({ ...prevState, maxRequestsPerTask: value })),
		setCustomInstructions: (value) => setState((prevState) => ({ ...prevState, customInstructions: value })),
		setAlwaysAllowReadOnly: (value) => setState((prevState) => ({ ...prevState, alwaysAllowReadOnly: value })),
		setShowAnnouncement: (value) => setState((prevState) => ({ ...prevState, shouldShowAnnouncement: value })),
	}

	if (!didHydrateState) {
		return null
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
