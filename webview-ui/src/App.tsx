import { useCallback, useEffect, useRef, useState } from "react"
import { useEvent } from "react-use"

import { ExtensionMessage } from "../../src/shared/ExtensionMessage"
import { ShowHumanRelayDialogMessage } from "../../src/shared/ExtensionMessage"

import { vscode } from "./utils/vscode"
import { telemetryClient } from "./utils/TelemetryClient"
import { ExtensionStateContextProvider, useExtensionState } from "./context/ExtensionStateContext"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView, { SettingsViewRef } from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeView"
import McpView from "./components/mcp/McpView"
import PromptsView from "./components/prompts/PromptsView"
import { HumanRelayDialog } from "./components/human-relay/HumanRelayDialog"

type Tab = "settings" | "history" | "mcp" | "prompts" | "chat"

type HumanRelayDialogState = {
	isOpen: boolean
	requestId: string
	promptText: string
}

const tabsByMessageAction: Partial<Record<NonNullable<ExtensionMessage["action"]>, Tab>> = {
	chatButtonClicked: "chat",
	settingsButtonClicked: "settings",
	promptsButtonClicked: "prompts",
	mcpButtonClicked: "mcp",
	historyButtonClicked: "history",
}

const App = () => {
	const { didHydrateState, showWelcome, shouldShowAnnouncement, telemetrySetting, telemetryKey, machineId } =
		useExtensionState()

	const [showAnnouncement, setShowAnnouncement] = useState(false)
	const [tab, setTab] = useState<Tab>("chat")
	const [humanRelayDialogState, setHumanRelayDialogState] = useState<HumanRelayDialogState>({
		isOpen: false,
		requestId: "",
		promptText: "",
	})

	const settingsRef = useRef<SettingsViewRef>(null)

	const switchTab = useCallback((newTab: Tab) => {
		if (settingsRef.current?.checkUnsaveChanges) {
			settingsRef.current.checkUnsaveChanges(() => setTab(newTab))
		} else {
			setTab(newTab)
		}
	}, [])

	const onMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			if (message.type === "action" && message.action) {
				const newTab = tabsByMessageAction[message.action]

				if (newTab) {
					switchTab(newTab)
				}
			}
			const mes: ShowHumanRelayDialogMessage = message as ShowHumanRelayDialogMessage
			// Processing displays human relay dialog messages
			if (mes.type === "showHumanRelayDialog" && mes.requestId && mes.promptText) {
				setHumanRelayDialogState({
					isOpen: true,
					requestId: mes.requestId,
					promptText: mes.promptText,
				})
			}
		},
		[switchTab],
	)

	useEvent("message", onMessage)

	useEffect(() => {
		if (shouldShowAnnouncement) {
			setShowAnnouncement(true)
			vscode.postMessage({ type: "didShowAnnouncement" })
		}
	}, [shouldShowAnnouncement])

	useEffect(() => {
		if (didHydrateState) {
			telemetryClient.updateTelemetryState(telemetrySetting, telemetryKey, machineId)
		}
	}, [telemetrySetting, telemetryKey, machineId, didHydrateState])

	// Tell the extension that we are ready to receive messages.
	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	if (!didHydrateState) {
		return null
	}

	// Do not conditionally load ChatView, it's expensive and there's state we
	// don't want to lose (user input, disableInput, askResponse promise, etc.)
	return showWelcome ? (
		<WelcomeView />
	) : (
		<>
			{tab === "prompts" && <PromptsView onDone={() => switchTab("chat")} />}
			{tab === "mcp" && <McpView onDone={() => switchTab("chat")} />}
			{tab === "history" && <HistoryView onDone={() => switchTab("chat")} />}
			{tab === "settings" && <SettingsView ref={settingsRef} onDone={() => setTab("chat")} />}
			<ChatView
				isHidden={tab !== "chat"}
				showAnnouncement={showAnnouncement}
				hideAnnouncement={() => setShowAnnouncement(false)}
				showHistoryView={() => switchTab("history")}
			/>
			<HumanRelayDialog
				isOpen={humanRelayDialogState.isOpen}
				requestId={humanRelayDialogState.requestId}
				promptText={humanRelayDialogState.promptText}
				onClose={() => setHumanRelayDialogState((prev) => ({ ...prev, isOpen: false }))}
				onSubmit={(requestId, text) => vscode.postMessage({ type: "humanRelayResponse", requestId, text })}
				onCancel={(requestId) => vscode.postMessage({ type: "humanRelayCancel", requestId })}
			/>
		</>
	)
}

const AppWithProviders = () => (
	<ExtensionStateContextProvider>
		<App />
	</ExtensionStateContextProvider>
)

export default AppWithProviders
