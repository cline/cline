import { useEffect, useRef, useCallback } from "react" // Added useCallback
import { useEvent } from "react-use" // Added useEvent
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import AccountView from "./components/account/AccountView"
import { useExtensionState } from "./store/extensionStore" // Changed import
import { vscode } from "./utils/vscode"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import { Providers } from "./Providers"
import { logger } from "./utils/logger"
import { ExtensionMessage } from "@shared/ExtensionMessage" // Added for typing

const AppContent = () => {
	const didHydrateState = useExtensionState((state) => state.didHydrateState)
	const showWelcome = useExtensionState((state) => state.showWelcome)
	const shouldShowAnnouncement = useExtensionState((state) => state.shouldShowAnnouncement)
	const showMcp = useExtensionState((state) => state.showMcp)
	const mcpTab = useExtensionState((state) => state.mcpTab)
	const showSettings = useExtensionState((state) => state.showSettings)
	const showHistory = useExtensionState((state) => state.showHistory)
	const showAccount = useExtensionState((state) => state.showAccount)
	const showAnnouncementView = useExtensionState((state) => state.showAnnouncementView) // Renamed in store
	const setShowAnnouncementView = useExtensionState((state) => state.setShowAnnouncementView) // Renamed in store
	const closeMcpView = useExtensionState((state) => state.closeMcpView)
	const navigateToHistory = useExtensionState((state) => state.navigateToHistory)
	const hideSettings = useExtensionState((state) => state.hideSettings)
	const hideHistory = useExtensionState((state) => state.hideHistory)
	const hideAccount = useExtensionState((state) => state.hideAccount)
	// hideAnnouncement is now setShowAnnouncementView(false) or navigating away

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncementView(true) // Use the store action
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
					{showHistory && <HistoryView onDone={hideHistory} />}
					{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
					{showAccount && <AccountView onDone={hideAccount} />}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						showHistoryView={navigateToHistory}
						isHidden={showSettings || showHistory || showMcp || showAccount}
						showAnnouncement={showAnnouncementView} // Use renamed state
						hideAnnouncement={() => setShowAnnouncementView(false)} // Use renamed action
					/>
				</>
			)}
		</>
	)
}

import { useMemo } from "react" // Added useMemo

const App = () => {
	const renderCountRef = useRef(0)
	renderCountRef.current += 1
	logger.debug(`[App.tsx] App component Render #${renderCountRef.current}`)

	const processMessage = useExtensionState((state) => state.processMessage)

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message = event.data as ExtensionMessage // Cast to known type
			logger.debug("[App.tsx] Received message from extension:", message.type, message)
			processMessage(message)
		},
		[processMessage],
	)

	useEvent("message", handleMessage) // Setup the event listener

	const appContentElement = useMemo(() => <AppContent />, [])
	return <Providers>{appContentElement}</Providers>
}

export default App
