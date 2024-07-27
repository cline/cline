import React, { useEffect, useState } from "react"
import "./App.css"

import ChatView from "./components/ChatView"
import SettingsView from "./components/SettingsView"
import { ClaudeMessage, ExtensionMessage } from "@shared/ExtensionMessage"
import WelcomeView from "./components/WelcomeView"
import TaskHistoryView from "./components/TaskHistoryView"
import { vscode } from "./utilities/vscode"

interface TaskHistoryItem {
	id: string
	description: string
	timestamp: number
	messages?: ClaudeMessage[]
}

const App: React.FC = () => {
	const [showSettings, setShowSettings] = useState(false)
	const [showWelcome, setShowWelcome] = useState<boolean>(false)
	const [showTaskHistory, setShowTaskHistory] = useState<boolean>(false)
	const [apiKey, setApiKey] = useState<string>("")
	const [maxRequestsPerTask, setMaxRequestsPerTask] = useState<string>("")
	const [claudeMessages, setClaudeMessages] = useState<ClaudeMessage[]>([])
	const [taskHistory, setTaskHistory] = useState<TaskHistoryItem[]>([])

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })

		const handleMessage = (e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			console.log("Received message in App.tsx:", message)
			switch (message.type) {
				case "state":
					const shouldShowWelcome = !message.state!.didOpenOnce || !message.state!.apiKey
					setShowWelcome(shouldShowWelcome)
					setApiKey(message.state!.apiKey || "")
					setMaxRequestsPerTask(
						message.state!.maxRequestsPerTask !== undefined
							? message.state!.maxRequestsPerTask.toString()
							: ""
					)
					setClaudeMessages(message.state!.claudeMessages)
					break
				case "action":
					switch (message.action!) {
						case "settingsButtonTapped":
							setShowSettings(true)
							setShowTaskHistory(false)
							break
						case "plusButtonTapped":
							setShowSettings(false)
							setShowTaskHistory(false)
							break
						case "viewTaskHistory":
							setShowTaskHistory(true)
							setShowSettings(false)
							break
					}
					break
				case "taskHistory":
					console.log("Received task history:", message.taskHistory)
					if (Array.isArray(message.taskHistory)) {
						setTaskHistory(
							message.taskHistory.map((task: any) => ({
								id: task.id,
								description: task.description,
								timestamp: task.timestamp,
								messages: Array.isArray(task.messages) ? (task.messages as ClaudeMessage[]) : [],
							}))
						)
					}
					break
				case "loadedTaskHistory":
					console.log("Received loaded task history:", message.messages)
					setClaudeMessages((message.messages as ClaudeMessage[]) || [])
					setShowTaskHistory(false)
					break
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	const handleMessagesUpdate = (newMessages: ClaudeMessage[]) => {
		console.log("Updating messages in App.tsx:", newMessages)
		setClaudeMessages(newMessages)
	}

	return (
		<>
			{showWelcome ? (
				<WelcomeView apiKey={apiKey} setApiKey={setApiKey} />
			) : (
				<>
					{showSettings && (
						<SettingsView
							apiKey={apiKey}
							setApiKey={setApiKey}
							maxRequestsPerTask={maxRequestsPerTask}
							setMaxRequestsPerTask={setMaxRequestsPerTask}
							onDone={() => setShowSettings(false)}
						/>
					)}
					{showTaskHistory && (
						<TaskHistoryView
							tasks={taskHistory}
							onSelectTask={(task) => {
								console.log("Selected task:", task)
								vscode.postMessage({ type: "loadTask", taskId: task.id })
							}}
							onClearHistory={() => {
								vscode.postMessage({ type: "clearTaskHistory" })
							}}
						/>
					)}
					<ChatView
						messages={claudeMessages}
						isHidden={showSettings || showTaskHistory}
						onMessagesUpdate={handleMessagesUpdate}
					/>
				</>
			)}
		</>
	)
}

export default App
