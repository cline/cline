import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { ApiConfiguration } from "../../src/shared/api"
import { ClaudeMessage, ExtensionMessage } from "../../src/shared/ExtensionMessage"
import "./App.css"
import { normalizeApiConfiguration } from "./components/ApiOptions"
import ChatView from "./components/ChatView"
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
	const [showWelcome, setShowWelcome] = useState<boolean>(false)
	const [version, setVersion] = useState<string>("")
	const [apiConfiguration, setApiConfiguration] = useState<ApiConfiguration | undefined>(undefined)
	const [maxRequestsPerTask, setMaxRequestsPerTask] = useState<string>("")
	const [vscodeThemeName, setVscodeThemeName] = useState<string | undefined>(undefined)
	const [claudeMessages, setClaudeMessages] = useState<ClaudeMessage[]>([])
	const [showAnnouncement, setShowAnnouncement] = useState(false)

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	const handleMessage = useCallback((e: MessageEvent) => {
		const message: ExtensionMessage = e.data
		switch (message.type) {
			case "state":
				setVersion(message.state!.version)
				const hasKey =
					message.state!.apiConfiguration?.apiKey !== undefined ||
					message.state!.apiConfiguration?.openRouterApiKey !== undefined ||
					message.state!.apiConfiguration?.awsAccessKey !== undefined
				setShowWelcome(!hasKey)
				setApiConfiguration(message.state!.apiConfiguration)
				setMaxRequestsPerTask(
					message.state!.maxRequestsPerTask !== undefined ? message.state!.maxRequestsPerTask.toString() : ""
				)
				setVscodeThemeName(message.state!.themeName)
				setClaudeMessages(message.state!.claudeMessages)
				// don't update showAnnouncement to false if shouldShowAnnouncement is false
				if (message.state!.shouldShowAnnouncement) {
					setShowAnnouncement(true)
					vscode.postMessage({ type: "didShowAnnouncement" })
				}
				setDidHydrateState(true)
				break
			case "action":
				switch (message.action!) {
					case "settingsButtonTapped":
						setShowSettings(true)
						break
					case "plusButtonTapped":
						setShowSettings(false)
						break
				}
				break
		}
		// we don't need to define any dependencies since we're not using any state in the callback. if you were to use state, you'd either have to include it in the dependency array or use the updater function `setUserText(prev => `${prev}${key}`);`. (react-use takes care of not registering the same listener multiple times even if this callback is updated.)
	}, [])

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
				<WelcomeView apiConfiguration={apiConfiguration} setApiConfiguration={setApiConfiguration} />
			) : (
				<>
					{showSettings && (
						<SettingsView
							version={version}
							apiConfiguration={apiConfiguration}
							setApiConfiguration={setApiConfiguration}
							maxRequestsPerTask={maxRequestsPerTask}
							setMaxRequestsPerTask={setMaxRequestsPerTask}
							onDone={() => setShowSettings(false)}
						/>
					)}
					{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
					<ChatView
						version={version}
						messages={claudeMessages}
						isHidden={showSettings}
						vscodeThemeName={vscodeThemeName}
						showAnnouncement={showAnnouncement}
						selectedModelSupportsImages={selectedModelInfo.supportsImages}
						hideAnnouncement={() => setShowAnnouncement(false)}
					/>
				</>
			)}
		</>
	)
}

export default App
