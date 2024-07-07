import React, { useEffect, useState } from "react"
import "./App.css"

import ChatSidebar from "./components/ChatSidebar"
import SettingsView from "./components/SettingsView"
import { ExtensionMessage } from "@shared/ExtensionMessage"

const App: React.FC = () => {
	const [showSettings, setShowSettings] = useState(false)

	useEffect(() => {
		window.addEventListener("message", (e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			if (message.type === "action") {
				switch (message.action!) {
					case "settingsButtonTapped":
						setShowSettings(true)
						break
					case "plusButtonTapped":
						setShowSettings(false)
						break
				}
			}
		})
	}, [])

	return <>{showSettings ? <SettingsView /> : <ChatSidebar />}</>
}

export default App
