import { useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { WebviewType } from "@shared/WebviewMessage"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView from "./components/settings/SettingsView"
import AccountView from "./components/account/AccountView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { vscode } from "./utils/vscode"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import { Providers } from "./Providers"
import { McpViewTab } from "@shared/mcp"
import WelcomeWrapper from "./components/welcome/WelcomeWrapper"

const AppContent = () => {
	const { didHydrateState, shouldShowAnnouncement, showMcp, mcpTab } = useExtensionState()
	const [showSettings, setShowSettings] = useState(false)
	const hideSettings = useCallback(() => setShowSettings(false), [])
	const [showHistory, setShowHistory] = useState(false)
	const [showAccount, setShowAccount] = useState(false)
	const [showAnnouncement, setShowAnnouncement] = useState(false)
	// Use local state for welcome view, initialized from extension state
	const [showWelcomeLocal, setShowWelcomeLocal] = useState(true)
	const { setShowWelcome } = useExtensionState()

	// Sync local state with extension state
	useEffect(() => {
		console.log("Setting showWelcome in extension state to true")
		setShowWelcome(true)
	}, [setShowWelcome])

	const { setShowMcp, setMcpTab } = useExtensionState()

	const closeMcpView = useCallback(() => {
		setShowMcp(false)
		setMcpTab(undefined)
	}, [setShowMcp, setMcpTab])

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			console.log("Received message in App.tsx:", message)
			switch (message.type) {
				case "showWelcome":
					console.log("Received showWelcome message in App.tsx")
					setShowWelcomeLocal(true)
					break
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
							setShowWelcomeLocal(false) // Hide welcome view when chat button is clicked
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
			{showWelcomeLocal ? (
				<WelcomeWrapper />
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
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
