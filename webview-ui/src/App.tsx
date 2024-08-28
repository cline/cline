import { useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../src/shared/ExtensionMessage"
import { normalizeApiConfiguration } from "./components/ApiOptions"
import ChatView from "./components/ChatView"
import HistoryView from "./components/HistoryView"
import SettingsView from "./components/SettingsView"
import WelcomeView from "./components/WelcomeView"
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import { vscode } from "./utils/vscode"

const AppContent = () => {
	const { apiConfiguration, shouldShowAnnouncement } = useExtensionState()
	const [showSettings, setShowSettings] = useState(false)
	const [showHistory, setShowHistory] = useState(false)
	const [showWelcome, setShowWelcome] = useState<boolean>(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	const handleMessage = useCallback((e: MessageEvent) => {
		const message: ExtensionMessage = e.data
		switch (message.type) {
			case "state":
				let hasKey = false
				const config = message.state?.apiConfiguration
				if (config) {
					const { apiKey, openRouterApiKey, awsAccessKey, vertexProjectId } = config
					hasKey = [apiKey, openRouterApiKey, awsAccessKey, vertexProjectId].some((key) => key !== undefined)
				} else {
					hasKey = false
				}
				setShowWelcome(!hasKey)
				break
			case "action":
				switch (message.action!) {
					case "settingsButtonTapped":
						setShowSettings(true)
						setShowHistory(false)
						break
					case "historyButtonTapped":
						setShowSettings(false)
						setShowHistory(true)
						break
					case "chatButtonTapped":
						setShowSettings(false)
						setShowHistory(false)
						break
				}
				break
		}
	}, [])

	useEvent("message", handleMessage)

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)
			vscode.postMessage({ type: "didShowAnnouncement" })
		}
	}, [shouldShowAnnouncement])

	return (
		<>
			{showWelcome ? (
				<WelcomeView />
			) : (
				<>
					{showSettings && <SettingsView onDone={() => setShowSettings(false)} />}
					{showHistory && <HistoryView onDone={() => setShowHistory(false)} />}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						showHistoryView={() => {
							setShowSettings(false)
							setShowHistory(true)
						}}
						isHidden={showSettings || showHistory}
						showAnnouncement={showAnnouncement}
						selectedModelSupportsImages={selectedModelInfo.supportsImages}
						selectedModelSupportsPromptCache={selectedModelInfo.supportsPromptCache}
						hideAnnouncement={() => {
							setShowAnnouncement(false)
						}}
					/>
				</>
			)}
		</>
	)
}

const App = () => {
	return (
		<ExtensionStateContextProvider>
			<AppContent />
		</ExtensionStateContextProvider>
	)
}

export default App
