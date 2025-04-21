import { useCallback, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import AccountView from "./components/account/AccountView"
import ApiStatsView from "./components/api-stats/ApiStatsView" // Import the new view
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import { FirebaseAuthProvider } from "./context/FirebaseAuthContext"
import { vscode } from "./utils/vscode"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import { McpViewTab } from "@shared/mcp"

const AppContent = () => {
	const { didHydrateState, showWelcome, shouldShowAnnouncement } = useExtensionState() // Removed unused telemetry vars
	const [showSettings, setShowSettings] = useState(false)
	const hideSettings = useCallback(() => setShowSettings(false), [])
	const [showHistory, setShowHistory] = useState(false)
	const [showMcp, setShowMcp] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showApiStats, setShowApiStats] = useState(false) // Add state for the new view
	const [showAnnouncement, setShowAnnouncement] = useState(false)
	const [mcpTab, setMcpTab] = useState<McpViewTab | undefined>(undefined)

	const handleMessage = useCallback((e: MessageEvent) => {
		const message: ExtensionMessage = e.data
		switch (message.type) {
			case "action":
				switch (message.action!) {
					case "settingsButtonClicked":
						setShowSettings(true)
						setShowHistory(false)
						setShowMcp(false)
						setShowAccount(false)
						setShowApiStats(false) // Reset new view state
						break
					case "historyButtonClicked":
						setShowSettings(false)
						setShowHistory(true)
						setShowMcp(false)
						setShowAccount(false)
						setShowApiStats(false) // Reset new view state
						break
					case "mcpButtonClicked":
						setShowSettings(false)
						setShowHistory(false)
						if (message.tab) {
							setMcpTab(message.tab)
						}
						setShowMcp(true)
						setShowAccount(false)
						setShowApiStats(false) // Reset new view state
						break
					case "accountButtonClicked":
						setShowSettings(false)
						setShowHistory(false)
						setShowMcp(false)
						setShowAccount(true)
						setShowApiStats(false) // Reset new view state
						break
					case "apiStatsButtonClicked": // Add case for the new button
						setShowSettings(false)
						setShowHistory(false)
						setShowMcp(false)
						setShowAccount(false)
						setShowApiStats(true)
						break
					case "chatButtonClicked":
						setShowSettings(false)
						setShowHistory(false)
						setShowMcp(false)
						setShowAccount(false)
						setShowApiStats(false) // Reset new view state
						break
				}
				break
		}
	}, [])

	useEvent("message", handleMessage)

	// useEffect(() => {
	// 	if (telemetrySetting === "enabled") {
	// 		posthog.identify(vscMachineId)
	// 		posthog.opt_in_capturing()
	// 	} else {
	// 		posthog.opt_out_capturing()
	// 	}
	// }, [telemetrySetting, vscMachineId])
	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)
			vscode.postMessage({ type: "didShowAnnouncement" })
		}
	}, [shouldShowAnnouncement])

	if (!didHydrateState) {
		return null
	}

	return (
		<>
			{showWelcome ? (
				<WelcomeView />
			) : (
				<>
					{showSettings && <SettingsView onDone={hideSettings} />}
					{showHistory && <HistoryView onDone={() => setShowHistory(false)} />}
					{showMcp && <McpView initialTab={mcpTab} onDone={() => setShowMcp(false)} />}
					{showAccount && <AccountView onDone={() => setShowAccount(false)} />}
					{showApiStats && <ApiStatsView onDone={() => setShowApiStats(false)} />} {/* Render the new view */}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						showHistoryView={() => {
							setShowSettings(false)
							setShowMcp(false)
							setShowAccount(false)
							setShowApiStats(false) // Reset new view state
							setShowHistory(true)
						}}
						isHidden={showSettings || showHistory || showMcp || showAccount || showApiStats}
						showAnnouncement={showAnnouncement}
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
			<FirebaseAuthProvider>
				<AppContent />
			</FirebaseAuthProvider>
		</ExtensionStateContextProvider>
	)
}

export default App
