import React, { useState, useEffect, useRef, useCallback } from "react"
import styled from "styled-components"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { useClickAway } from "react-use"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react" // Removed VSCodeCheckbox
// Removed CODE_BLOCK_BG_COLOR
import { McpServer } from "../../../../src/shared/mcp"
import McpServerRow from "./McpServerRow" // Import the new component

interface McpServerStatusPopupProps {
	buttonRef: React.RefObject<HTMLDivElement> // Keep buttonRef if needed for other logic, but not for positioning here
	onClose: () => void
}

// Removed McpPopupContainerProps interface
// Removed McpPopupContainer styled component
// Removed ServerRow, ServerName, ServerActions, ToggleSwitch styled components as they are now in McpServerRow

const PopupFooter = styled.div`
	display: flex;
	justify-content: space-between;
	padding-top: 8px;
	border-top: 1px solid var(--vscode-editorGroup-border);
	flex-shrink: 0; // Keep footer from shrinking if needed within the outer tooltip's flex context
	margin-top: 8px; // Add some margin to separate from the list
`

// Note: Removed buttonRef from props as it's not used for positioning within this component anymore
const McpServerStatusPopup: React.FC<McpServerStatusPopupProps> = ({ onClose }) => {
	const { mcpServers } = useExtensionState()
	const popupRef = useRef<HTMLDivElement>(null) // Ref for the content root for click-away

	// Removed state and useEffect for arrowPosition and menuPosition

	// Close popup when clicking outside THIS component's content
	// The outer tooltip in ChatTextArea handles clicks outside the tooltip area
	useClickAway(popupRef, onClose) // Simplified click away

	// Removed handleToggle and handleRestart as they are now in McpServerRow

	const handleRestartAll = useCallback(() => {
		vscode.postMessage({ type: "restartAllMcpServers" })
	}, [])

	const handleOpenConfig = useCallback(() => {
		vscode.postMessage({ type: "openMcpSettings" })
		onClose()
	}, [onClose])

	// Return content directly, wrapped in a div with the ref for click-away
	return (
		<div ref={popupRef}>
			{/* Debug Info Line */}
			<div
				style={{
					paddingBottom: "5px",
					borderBottom: "1px solid var(--vscode-editorGroup-border)",
					marginBottom: "5px",
					fontSize: "10px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Debug Info: Server Count = {mcpServers?.length ?? 0}
			</div>
			{/* Render server list using McpServerRow */}
			{(mcpServers ?? []).length === 0 && <div style={{ padding: "6px 0" }}>No MCP Servers configured.</div>}
			{(mcpServers ?? []).map((server) => (
				<McpServerRow key={server.name} server={server} />
			))}
			{/* Render footer directly after the list */}
			<PopupFooter>
				<VSCodeButton appearance="secondary" onClick={handleRestartAll}>
					Restart All
				</VSCodeButton>
				{/* Add separate buttons for global/local config */}
				<div style={{ display: "flex", gap: "5px" }}>
					<VSCodeButton
						appearance="secondary"
						title="Open global MCP settings file"
						onClick={() => vscode.postMessage({ type: "openMcpSettings" })}>
						<span className="codicon codicon-globe" style={{ marginRight: "3px" }}></span>
						Global Config
					</VSCodeButton>
					<VSCodeButton
						appearance="secondary"
						title="Open local project MCP settings file (.cline_mcp_servers.json)"
						onClick={() => vscode.postMessage({ type: "openLocalMcpSettings" })}>
						<span className="codicon codicon-folder-opened" style={{ marginRight: "3px" }}></span>
						Local Config
					</VSCodeButton>
				</div>
			</PopupFooter>
		</div>
	)
}

export default McpServerStatusPopup
