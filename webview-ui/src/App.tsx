import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { useCallback, useEffect, useState } from "react"
import AccountView from "./components/account/AccountView"
import ChatView from "./components/chat/ChatView"
import ClineKanbanLaunchModal, { CLINE_KANBAN_MODAL_DISMISS_ID } from "./components/common/ClineKanbanLaunchModal"
import HistoryView from "./components/history/HistoryView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import OnboardingView from "./components/onboarding/OnboardingView"
import SettingsView from "./components/settings/SettingsView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useClineAuth } from "./context/ClineAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { StateServiceClient, UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		dismissedBanners,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		hideAnnouncement,
	} = useExtensionState()
	const [showKanbanModal, setShowKanbanModal] = useState(false)
	const [hasShownKanbanModal, setHasShownKanbanModal] = useState(false)

	const { clineUser, organizations, activeOrganization } = useClineAuth()

	const showUpdateAnnouncementModal = useCallback(() => {
		setShowAnnouncement(true)
		UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
			.then((response: Boolean) => {
				setShouldShowAnnouncement(response.value)
			})
			.catch((error) => {
				console.error("Failed to acknowledge announcement:", error)
			})
	}, [setShouldShowAnnouncement, setShowAnnouncement])

	useEffect(() => {
		if (!didHydrateState || showWelcome || hasShownKanbanModal) {
			return
		}
		const hasDismissedKanbanModal = dismissedBanners?.some((banner) => banner.bannerId === CLINE_KANBAN_MODAL_DISMISS_ID)
		if (!hasDismissedKanbanModal) {
			setShowKanbanModal(true)
		}
		setHasShownKanbanModal(true)
	}, [didHydrateState, dismissedBanners, hasShownKanbanModal, showWelcome])

	// Keep update announcements queued until the Kanban modal has either shown and closed or been skipped.
	useEffect(() => {
		if (!didHydrateState || showWelcome || !shouldShowAnnouncement || showAnnouncement) {
			return
		}
		const isKanbanModalBlocking = showKanbanModal || !hasShownKanbanModal
		if (isKanbanModalBlocking) {
			return
		}
		showUpdateAnnouncementModal()
	}, [
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showAnnouncement,
		showKanbanModal,
		hasShownKanbanModal,
		showUpdateAnnouncementModal,
	])

	const handleCloseKanbanModal = useCallback((doNotShowAgain: boolean) => {
		setShowKanbanModal(false)
		if (doNotShowAgain) {
			StateServiceClient.dismissBanner({ value: CLINE_KANBAN_MODAL_DISMISS_ID }).catch((error) =>
				console.error("Failed to persist Cline Kanban modal dismissal:", error),
			)
		}
	}, [])

	if (!didHydrateState) {
		return null
	}

	if (showWelcome) {
		return <OnboardingView />
	}

	return (
		<div className="flex h-screen w-full flex-col">
			<ClineKanbanLaunchModal onClose={handleCloseKanbanModal} open={showKanbanModal} />
			{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showAccount && (
				<AccountView
					activeOrganization={activeOrganization}
					clineUser={clineUser}
					onDone={hideAccount}
					organizations={organizations}
				/>
			)}
			{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showMcp || showAccount || showWorktrees}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
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
