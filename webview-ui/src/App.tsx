import React, { useState } from "react"
import logo from "./logo.svg"
import "./App.css"

import { vscode } from "./utilities/vscode"
import {
	VSCodeBadge,
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDataGrid,
	VSCodeDataGridCell,
	VSCodeDataGridRow,
	VSCodeDivider,
	VSCodeDropdown,
	VSCodeLink,
	VSCodeOption,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
	VSCodeProgressRing,
	VSCodeRadio,
	VSCodeRadioGroup,
	VSCodeTag,
	VSCodeTextArea,
	VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react"
import ChatSidebar from "./components/ChatSidebar"
import Demo from "./components/Demo"
import SettingsView from "./components/SettingsView"

const App: React.FC = () => {
	const [showSettings, setShowSettings] = useState(true)

	const handleHowdyClick = () => {
		vscode.postMessage({
			command: "hello",
			text: "Hey there partner! 🤠",
		})
	}

	return <>{showSettings ? <SettingsView /> : <ChatSidebar />}</>
}

export default App
