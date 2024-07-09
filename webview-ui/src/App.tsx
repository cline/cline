import React, { useEffect, useState } from "react"
import "./App.css"

import ChatView from "./components/ChatView"
import SettingsView from "./components/SettingsView"
import { ClaudeMessage, ExtensionMessage } from "@shared/ExtensionMessage"
import WelcomeView from "./components/WelcomeView"
import { vscode } from "./utilities/vscode"

/*
The contents of webviews however are created when the webview becomes visible and destroyed when the webview is moved into the background. Any state inside the webview will be lost when the webview is moved to a background tab.

The best way to solve this is to make your webview stateless. Use message passing to save off the webview's state and then restore the state when the webview becomes visible again.


*/

const App: React.FC = () => {
	const [showSettings, setShowSettings] = useState(false)
	const [showWelcome, setShowWelcome] = useState<boolean>(false)
	const [apiKey, setApiKey] = useState<string>("")
	const [maxRequestsPerTask, setMaxRequestsPerTask] = useState<string>("")
	const [claudeMessages, setClaudeMessages] = useState<ClaudeMessage[]>([])

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
		window.addEventListener("message", (e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			// switch message.type
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
							break
						case "plusButtonTapped":
							setShowSettings(false)
							break
					}
					break
			}
		})
	}, [])

	// dummy data for messages
	const generateRandomTimestamp = (baseDate: Date, rangeInDays: number): number => {
		const rangeInMs = rangeInDays * 24 * 60 * 60 * 1000 // convert days to milliseconds
		const randomOffset = Math.floor(Math.random() * rangeInMs * 2) - rangeInMs // rangeInMs * 2 to have offset in both directions
		return baseDate.getTime() + randomOffset
	}

	const baseDate = new Date("2024-07-08T00:00:00Z")

	const messages: ClaudeMessage[] = [
		{
			type: "say",
			say: "task",
			text: "Starting task, this is my requeirements",
			ts: generateRandomTimestamp(baseDate, 1),
		},
		{
			type: "ask",
			ask: "request_limit_reached",
			text: "Request limit reached",
			ts: generateRandomTimestamp(baseDate, 2),
		},
		{ type: "ask", ask: "followup", text: "Any additional questions?", ts: generateRandomTimestamp(baseDate, 3) },
		{ type: "say", say: "error", text: "An error occurred", ts: generateRandomTimestamp(baseDate, 4) },

		{ type: "say", say: "text", text: "Some general text", ts: generateRandomTimestamp(baseDate, 7) },
		{ type: "say", say: "tool", text: "Using a tool", ts: generateRandomTimestamp(baseDate, 8) },

		// First command sequence
		{ type: "ask", ask: "command", text: "ls -l", ts: generateRandomTimestamp(baseDate, 9) },
		{ type: "say", say: "command_output", text: "file1.txt", ts: generateRandomTimestamp(baseDate, 10) },
		{
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request: "GET /api/data" }),
			ts: generateRandomTimestamp(baseDate, 5),
		},
		{ type: "say", say: "command_output", text: "file2.txt", ts: generateRandomTimestamp(baseDate, 11) },
		{ type: "say", say: "command_output", text: "directory1", ts: generateRandomTimestamp(baseDate, 12) },

		{ type: "say", say: "text", text: "Interrupting text", ts: generateRandomTimestamp(baseDate, 13) },
		{
			type: "say",
			say: "api_req_finished",
			text: JSON.stringify({ cost: "GET /api/data" }),
			ts: generateRandomTimestamp(baseDate, 6),
		},
		// Second command sequence
		{ type: "ask", ask: "command", text: "pwd", ts: generateRandomTimestamp(baseDate, 14) },
		{ type: "say", say: "command_output", text: "/home/user", ts: generateRandomTimestamp(baseDate, 15) },

		{ type: "ask", ask: "completion_result", text: "Task completed", ts: generateRandomTimestamp(baseDate, 16) },

		// Third command sequence (no output)
		{ type: "ask", ask: "command", text: "echo Hello", ts: generateRandomTimestamp(baseDate, 17) },

		// Testing combineApiRequests
		{ type: "say", say: "text", text: "Final message", ts: generateRandomTimestamp(baseDate, 18) },
		{ type: "ask", ask: "command", text: "ls -l", ts: generateRandomTimestamp(baseDate, 19) },
		{ type: "say", say: "command_output", text: "file1.txt", ts: generateRandomTimestamp(baseDate, 20) },
		{
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request: "GET /api/data" }),
			ts: generateRandomTimestamp(baseDate, 23),
		},
		{ type: "say", say: "command_output", text: "file2.txt", ts: generateRandomTimestamp(baseDate, 24) },
		{ type: "say", say: "text", text: "Some random text", ts: generateRandomTimestamp(baseDate, 25) },
		{
			type: "say",
			say: "api_req_finished",
			text: JSON.stringify({ cost: 0.005 }),
			ts: generateRandomTimestamp(baseDate, 26),
		},
		{ type: "ask", ask: "command", text: "pwd", ts: generateRandomTimestamp(baseDate, 27) },
		{ type: "say", say: "command_output", text: "/home/user", ts: generateRandomTimestamp(baseDate, 28) },
		{
			type: "say",
			say: "api_req_started",
			text: JSON.stringify({ request: "POST /api/update" }),
			ts: generateRandomTimestamp(baseDate, 29),
		},
		{ type: "say", say: "text", text: "Final message", ts: generateRandomTimestamp(baseDate, 30) },
	]

	return (
		<>
			{showWelcome ? (
				<WelcomeView apiKey={apiKey} setApiKey={setApiKey} />
			) : showSettings ? (
				<SettingsView
					apiKey={apiKey}
					setApiKey={setApiKey}
					maxRequestsPerTask={maxRequestsPerTask}
					setMaxRequestsPerTask={setMaxRequestsPerTask}
					onDone={() => setShowSettings(false)}
				/>
			) : (
				<ChatView messages={messages} />
			)}
		</>
	)
}

export default App
