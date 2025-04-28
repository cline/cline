import { useCallback, useEffect, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import AccountView from "./components/account/AccountView"
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import { FirebaseAuthProvider } from "./context/FirebaseAuthContext"
import { vscode } from "./utils/vscode"
import McpView from "./components/mcp/configuration/McpConfigurationView"

const AppContent = () => {
	const { didHydrateState, showWelcome, shouldShowAnnouncement, showMcp, mcpTab } = useExtensionState()
	const [showSettings, setShowSettings] = useState(false)
	const hideSettings = useCallback(() => setShowSettings(false), [])
	const [showHistory, setShowHistory] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	const { setShowMcp, setMcpTab } = useExtensionState()

	const closeMcpView = useCallback(() => {
		setShowMcp(false)
		setMcpTab(undefined)
	}, [setShowMcp, setMcpTab])

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "settingsButtonClicked":
							setShowSettings(true)
							setShowHistory(false)
							closeMcpView()
							setShowAccount(false)
							break
						case "historyButtonClicked":
							setShowSettings(false)
							setShowHistory(true)
							closeMcpView()
							setShowAccount(false)
							break
						case "mcpButtonClicked":
							setShowSettings(false)
							setShowHistory(false)
							if (message.tab) {
								setMcpTab(message.tab)
							}
							setShowMcp(true)
							setShowAccount(false)
							break
						case "accountButtonClicked":
							setShowSettings(false)
							setShowHistory(false)
							closeMcpView()
							setShowAccount(true)
							break
						case "chatButtonClicked":
							setShowSettings(false)
							setShowHistory(false)
							closeMcpView()
							setShowAccount(false)
							break
					}
					break
			}
		},
		[setShowMcp, setMcpTab, closeMcpView],
	)

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
					{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
					{showAccount && <AccountView onDone={() => setShowAccount(false)} />}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						showHistoryView={() => {
							setShowSettings(false)
							closeMcpView()
							setShowAccount(false)
							setShowHistory(true)
						}}
						isHidden={showSettings || showHistory || showMcp || showAccount}
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
