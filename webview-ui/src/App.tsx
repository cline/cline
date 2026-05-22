import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { useEffect } from "react"
import ChatView from "./components/chat/ChatView"
import ConnectorsView from "./components/connectors/ConnectorsView"
import HistoryView from "./components/history/HistoryView"
import MapPanel from "./components/map/MapPanel"
import MapView from "./components/map/MapView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import SkillsView from "./components/skills/SkillsView"
import WelcomeView from "./components/welcome/WelcomeView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

// Check if running in standalone map mode (separate panel)
const isStandaloneMapMode = () => {
	return typeof window !== "undefined" && (window as any).AIHYDRO_MAP_STANDALONE === true
}

const AppContent = () => {
	// Otherwise, render normal app UI
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showMcp,
		mcpTab,
		showSettings,
		showHistory,
		showMap,
		showConnectors,
		showSkills,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideMap,
		hideConnectors,
		hideSkills,
		hideAnnouncement,
	} = useExtensionState()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShouldShowAnnouncement(response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShouldShowAnnouncement, setShowAnnouncement])

	// Show loading screen with spinner
	if (!didHydrateState) {
		return (
			<div className="flex h-screen w-full items-center justify-center bg-[var(--vscode-editor-background)]">
				<div className="flex flex-col items-center space-y-4">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--vscode-progressBar-background)] border-t-transparent"></div>
					<div className="text-sm text-[var(--vscode-descriptionForeground)]">Loading AI-Hydro...</div>
				</div>
			</div>
		)
	}

	if (showWelcome) {
		return <WelcomeView />
	}

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView onDone={hideSettings} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showConnectors && <ConnectorsView onDone={hideConnectors} />}
			{showSkills && <SkillsView onDone={hideSkills} />}
			{showMap && <MapPanel />}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showMcp || showConnectors || showSkills || showMap}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	// Check if in standalone map mode and render directly with Providers
	if (isStandaloneMapMode()) {
		return (
			<Providers>
				<div className="flex h-screen w-full">
					<MapView height={window.innerHeight} width={window.innerWidth} />
				</div>
			</Providers>
		)
	}

	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
