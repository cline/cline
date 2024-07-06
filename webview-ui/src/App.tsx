import React from "react"
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

const App: React.FC = () => {
	const handleHowdyClick = () => {
		vscode.postMessage({
			command: "hello",
			text: "Hey there partner! 🤠",
		})
	}

	return (
		// REMOVE COLOR
		<main style={{backgroundColor: '#232526'}}>
			<ChatSidebar />
		</main>
	)
}

export default App
