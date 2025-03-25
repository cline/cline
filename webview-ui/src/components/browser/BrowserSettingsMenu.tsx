import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useRef } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

interface BrowserSettingsMenuProps {
	maxWidth?: number
}

export const BrowserSettingsMenu: React.FC<BrowserSettingsMenuProps> = ({ maxWidth }) => {
	const { browserSettings } = useExtensionState()
	const containerRef = useRef<HTMLDivElement>(null)

	const openBrowserSettings = () => {
		// First open the settings panel
		vscode.postMessage({
			type: "openSettings"
		})
		
		// After a short delay, send a message to scroll to browser settings
		setTimeout(() => {
			vscode.postMessage({
				type: "scrollToBrowserSettings"
			})
		}, 300) // Give the settings panel time to open
	}

	return (
		<div ref={containerRef} style={{ position: "relative", marginTop: "-1px" }}>
			<VSCodeButton appearance="icon" onClick={openBrowserSettings}>
				<i className="codicon codicon-settings-gear" style={{ fontSize: "14.5px" }} />
			</VSCodeButton>
		</div>
	)
}

export default BrowserSettingsMenu
