import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { useEffect } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import { useClineAuth } from "./context/ClineAuthContext"
import { NavigationView, UIShowType, useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const { didHydrateState, showWelcome, shouldShowAnnouncement, uiShowState, navigateToView, setShow, uiViewState } =
		useExtensionState()

	const { clineUser, organizations, activeOrganization } = useClineAuth()

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShow(UIShowType.ANNOUNCEMENT, true)

			// Use the gRPC client instead of direct WebviewMessage
			UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
				.then((response: Boolean) => {
					setShow(UIShowType.ANNOUNCEMENT, response.value)
				})
				.catch((error) => {
					console.error("Failed to acknowledge announcement:", error)
				})
		}
	}, [shouldShowAnnouncement, setShow])

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return <WelcomeView />
	}

	const onDone = () => navigateToView(NavigationView.CHAT)

	return (
		<div className="flex h-screen w-full flex-col">
			{uiViewState.view === NavigationView.SETTINGS && <SettingsView onDone={onDone} />}
			{uiViewState.view === NavigationView.HISTORY && <HistoryView onDone={onDone} />}
			{uiViewState.view === NavigationView.MCP && <McpView initialTab={uiViewState.tab} onDone={onDone} />}
			{uiViewState.view === NavigationView.ACCOUNT && (
				<AccountView
					activeOrganization={activeOrganization}
					clineUser={clineUser}
					onDone={onDone}
					organizations={organizations}
				/>
			)}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={setShow.bind(null, UIShowType.ANNOUNCEMENT, false)}
				isHidden={uiViewState.view !== NavigationView.CHAT}
				showAnnouncement={uiShowState.showAnnouncement}
				showHistoryView={() => navigateToView(NavigationView.HISTORY)}
			/>
		</div>
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
