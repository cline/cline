import React, { useState, useCallback, useMemo } from "react"
import styled from "styled-components"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react" // Removed VSCodeCheckbox
import { McpServer, MCP_SOURCE_PROJECT, MCP_SOURCE_GLOBAL } from "../../../../src/shared/mcp" // Import constants
import { vscode } from "../../utils/vscode"
import Tooltip from "../common/Tooltip"

// --- Styled Components (Copied from McpServerStatusPopup/McpView as needed) ---

const ServerRowContainer = styled.div`
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 4px 0;
`

const ServerNameContainer = styled.div`
	display: flex;
	align-items: center;
	gap: 6px; // Space between name and info icon
	flex-shrink: 1;
	overflow: hidden; // Ensure container handles overflow
	margin-right: 8px;
`

const ServerName = styled.span`
	font-weight: normal;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	margin-right: 4px; // Add space before source indicator
`

// New styled component for the source indicator
const SourceIndicator = styled.span`
	font-size: 0.8em;
	color: var(--vscode-descriptionForeground);
	margin-right: 6px; // Space before info icon
	font-style: italic;
`

const InfoIcon = styled.span`
	cursor: help; // Indicate it's informative
	color: var(--vscode-descriptionForeground);
	&:hover {
		color: var(--vscode-foreground);
	}
`

const ServerActions = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	flex-shrink: 0;
`

// Using the better toggle switch style from McpView.tsx
const ToggleSwitchContainer = styled.div`
	display: flex;
	align-items: center;
	margin-left: 8px; // Keep spacing consistent
`

const ToggleSwitchBody = styled.div<{ disabled?: boolean; checked?: boolean }>`
	width: 20px;
	height: 10px;
	background-color: ${(props) =>
		props.checked ? "var(--vscode-testing-iconPassed)" : "var(--vscode-titleBar-inactiveForeground)"};
	border-radius: 5px;
	position: relative;
	cursor: pointer;
	transition: background-color 0.2s;
	opacity: ${(props) => (props.disabled ? 0.5 : 0.9)};
`

const ToggleSwitchThumb = styled.div<{ checked?: boolean }>`
	width: 6px;
	height: 6px;
	background-color: white;
	border: 1px solid color-mix(in srgb, #666666 65%, transparent);
	border-radius: 50%;
	position: absolute;
	top: 1px;
	left: ${(props) => (props.checked ? "12px" : "2px")};
	transition: left 0.2s;
`

const StatusDot = styled.div<{ status: McpServer["status"] }>`
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: ${(props) => {
		switch (props.status) {
			case "connected":
				return "var(--vscode-testing-iconPassed)"
			case "connecting":
				return "var(--vscode-charts-yellow)"
			case "disconnected":
			default:
				return "var(--vscode-testing-iconFailed)"
		}
	}};
	margin-left: 8px; // Add margin if placing after actions
`

// --- Component ---

interface McpServerRowProps {
	server: McpServer
}

const McpServerRow: React.FC<McpServerRowProps> = ({ server }) => {
	const [isInfoHovering, setIsInfoHovering] = useState(false)
	const [isSourceHovering, setIsSourceHovering] = useState(false) // State for source tooltip

	const handleToggle = useCallback(() => {
		const action = server.disabled ? "enable" : "disable"
		vscode.postMessage({
			type: "manageMcpServer",
			payload: { serverId: server.name, action },
		})
	}, [server.name, server.disabled])

	const handleRestart = useCallback(() => {
		vscode.postMessage({
			type: "manageMcpServer",
			payload: { serverId: server.name, action: "restart" },
		})
	}, [server.name])

	// Generate Tooltip Text
	const tooltipText = useMemo(() => {
		let text = ""
		if (server.tools && server.tools.length > 0) {
			text += "Tools:\n" + server.tools.map((t) => `- ${t.name}`).join("\n")
		}
		const resources = [...(server.resources ?? []), ...(server.resourceTemplates ?? [])]
		if (resources.length > 0) {
			if (text) text += "\n\n" // Add spacing if tools were listed
			text += "Resources:\n" + resources.map((r) => `- ${r.name}`).join("\n")
		}
		return text || "No tools or resources listed."
	}, [server.tools, server.resources, server.resourceTemplates])

	return (
		<ServerRowContainer>
			<ServerNameContainer>
				<ServerName title={server.name}>{server.name}</ServerName>
				{/* Add Source Indicator with its own Tooltip */}
				{server.source && (
					<Tooltip visible={isSourceHovering} tipText={`Defined in ${server.source} settings`} hintText="">
						<SourceIndicator
							onMouseEnter={() => setIsSourceHovering(true)}
							onMouseLeave={() => setIsSourceHovering(false)}>
							({server.source === MCP_SOURCE_PROJECT ? "project" : "global"}) {/* Use constants for display text */}
						</SourceIndicator>
					</Tooltip>
				)}
				<Tooltip visible={isInfoHovering} tipText={tooltipText} hintText="">
					<InfoIcon
						className="codicon codicon-info"
						onMouseEnter={() => setIsInfoHovering(true)}
						onMouseLeave={() => setIsInfoHovering(false)}
					/>
				</Tooltip>
			</ServerNameContainer>
			<ServerActions>
				{/* Restart Button */}
				<VSCodeButton
					appearance="icon"
					title="Restart Server"
					disabled={server.disabled || server.status === "connecting"}
					onClick={handleRestart}>
					<span className="codicon codicon-refresh"></span>
				</VSCodeButton>

				{/* Toggle Switch (using McpView style) */}
				<ToggleSwitchContainer
					role="switch"
					aria-checked={!server.disabled}
					tabIndex={0}
					title={server.disabled ? "Enable Server" : "Disable Server"}
					onClick={handleToggle}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							handleToggle()
						}
					}}>
					<ToggleSwitchBody checked={!server.disabled} disabled={false}>
						<ToggleSwitchThumb checked={!server.disabled} />
					</ToggleSwitchBody>
				</ToggleSwitchContainer>

				{/* Status Dot */}
				<StatusDot status={server.status} />
			</ServerActions>
		</ServerRowContainer>
	)
}

export default McpServerRow
