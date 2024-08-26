import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { ApiConfiguration } from "../../src/shared/api"
import { ClaudeMessage, ExtensionMessage } from "../../src/shared/ExtensionMessage"
import { HistoryItem } from "../../src/shared/HistoryItem"
import "./App.css"
import { normalizeApiConfiguration } from "./components/ApiOptions"
import ChatView from "./components/ChatView"
import HistoryView from "./components/HistoryView"
import SettingsView from "./components/SettingsView"
import WelcomeView from "./components/WelcomeView"
import { vscode } from "./utils/vscode"

/*
The contents of webviews however are created when the webview becomes visible and destroyed when the webview is moved into the background. Any state inside the webview will be lost when the webview is moved to a background tab.

The best way to solve this is to make your webview stateless. Use message passing to save off the webview's state and then restore the state when the webview becomes visible again.
*/

const App: React.FC = () => {
	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showSettings, setShowSettings] = useState(false)
	const [showHistory, setShowHistory] = useState(false)
	const [showWelcome, setShowWelcome] = useState<boolean>(false)
	const [version, setVersion] = useState<string>("")
	const [apiConfiguration, setApiConfiguration] = useState<ApiConfiguration | undefined>(undefined)
	const [maxRequestsPerTask, setMaxRequestsPerTask] = useState<string>("")
	const [customInstructions, setCustomInstructions] = useState<string>("")
	const [alwaysAllowReadOnly, setAlwaysAllowReadOnly] = useState<boolean>(false)
	const [vscodeThemeName, setVscodeThemeName] = useState<string | undefined>(undefined)
	const [vscodeUriScheme, setVscodeUriScheme] = useState<string | undefined>(undefined)
	const [claudeMessages, setClaudeMessages] = useState<ClaudeMessage[]>([])
	const [taskHistory, setTaskHistory] = useState<HistoryItem[]>([])
	const [showAnnouncement, setShowAnnouncement] = useState(false)
	const [koduCredits, setKoduCredits] = useState<number | undefined>(undefined)
	const [shouldShowKoduPromo, setShouldShowKoduPromo] = useState(true)
	const [didAuthKoduFromWelcome, setDidAuthKoduFromWelcome] = useState<boolean>(false)

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			switch (message.type) {
				case "state":
					setVersion(message.state!.version)
					const hasKey =
						message.state!.apiConfiguration?.apiKey !== undefined ||
						message.state!.apiConfiguration?.openRouterApiKey !== undefined ||
						message.state!.apiConfiguration?.awsAccessKey !== undefined ||
						message.state!.apiConfiguration?.koduApiKey !== undefined
					setShowWelcome(!hasKey)
					if (!hasKey) {
						setDidAuthKoduFromWelcome(false)
					}
					setApiConfiguration(message.state!.apiConfiguration)
					setMaxRequestsPerTask(
						message.state!.maxRequestsPerTask !== undefined
							? message.state!.maxRequestsPerTask.toString()
							: ""
					)
					setCustomInstructions(message.state!.customInstructions || "")
					setAlwaysAllowReadOnly(message.state!.alwaysAllowReadOnly || false)
					setVscodeThemeName(message.state!.themeName)
					setVscodeUriScheme(message.state!.uriScheme)
					setClaudeMessages(message.state!.claudeMessages)
					setTaskHistory(message.state!.taskHistory)
					setKoduCredits(message.state!.koduCredits)
					// don't update showAnnouncement to false if shouldShowAnnouncement is false
					if (message.state!.shouldShowAnnouncement) {
						setShowAnnouncement(true)
					}
					setShouldShowKoduPromo(message.state!.shouldShowKoduPromo)
					setDidHydrateState(true)
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
						case "koduCreditsFetched":
							setKoduCredits(message.state!.koduCredits)
							break
						case "koduAuthenticated":
							if (!didAuthKoduFromWelcome) {
								setShowSettings(true)
								setShowHistory(false)
							}
							break
					}
					break
			}
			// (react-use takes care of not registering the same listener multiple times even if this callback is updated.)
		},
		[didAuthKoduFromWelcome]
	)

	useEvent("message", handleMessage)

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	if (!didHydrateState) {
		return null
	}

	return (
		<>
			{showWelcome ? (
				<WelcomeView
					apiConfiguration={apiConfiguration}
					setApiConfiguration={setApiConfiguration}
					vscodeUriScheme={vscodeUriScheme}
					setDidAuthKoduFromWelcome={setDidAuthKoduFromWelcome}
				/>
			) : (
				<>
					{showSettings && (
						<SettingsView
							version={version}
							apiConfiguration={apiConfiguration}
							setApiConfiguration={setApiConfiguration}
							koduCredits={koduCredits}
							maxRequestsPerTask={maxRequestsPerTask}
							setMaxRequestsPerTask={setMaxRequestsPerTask}
							customInstructions={customInstructions}
							setCustomInstructions={setCustomInstructions}
							alwaysAllowReadOnly={alwaysAllowReadOnly}
							setAlwaysAllowReadOnly={setAlwaysAllowReadOnly}
							onDone={() => setShowSettings(false)}
							vscodeUriScheme={vscodeUriScheme}
						/>
					)}
					{showHistory && <HistoryView taskHistory={taskHistory} onDone={() => setShowHistory(false)} />}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						version={version}
						messages={claudeMessages}
						taskHistory={taskHistory}
						showHistoryView={() => {
							setShowSettings(false)
							setShowHistory(true)
						}}
						isHidden={showSettings || showHistory}
						vscodeThemeName={vscodeThemeName}
						showAnnouncement={showAnnouncement}
						selectedModelSupportsImages={selectedModelInfo.supportsImages}
						selectedModelSupportsPromptCache={selectedModelInfo.supportsPromptCache}
						hideAnnouncement={() => {
							vscode.postMessage({ type: "didCloseAnnouncement" })
							setShowAnnouncement(false)
						}}
						apiConfiguration={apiConfiguration}
						vscodeUriScheme={vscodeUriScheme}
						shouldShowKoduPromo={shouldShowKoduPromo}
						koduCredits={koduCredits}
					/>
				</>
			)}
		</>
	)
}

export default App
