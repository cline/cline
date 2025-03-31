import {
	VSCodeButton,
	VSCodeLink,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeCheckbox,
} from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState, useCallback, useMemo } from "react" // Added useCallback, useMemo
import styled from "styled-components"
import { DEFAULT_MCP_TIMEOUT_SECONDS, McpServer } from "../../../../src/shared/mcp"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { getMcpServerDisplayName } from "../../utils/mcp"
import { vscode } from "../../utils/vscode"
import McpMarketplaceView from "./marketplace/McpMarketplaceView"
import McpResourceRow from "./McpResourceRow"
import McpToolRow from "./McpToolRow"
import DangerButton from "../common/DangerButton"
import Tooltip from "../common/Tooltip"
import { MCP_SOURCE_PROJECT } from "../../../../src/shared/mcp" // Import constant

type McpViewProps = {
	onDone: () => void
}

export const McpView = ({ onDone }: McpViewProps) => {
	// Added export keyword
	const { mcpServers: servers, mcpMarketplaceEnabled } = useExtensionState()
	const [activeTab, setActiveTab] = useState(mcpMarketplaceEnabled ? "marketplace" : "installed")

	const handleTabChange = (tab: string) => {
		setActiveTab(tab)
	}

	useEffect(() => {
		if (!mcpMarketplaceEnabled && activeTab === "marketplace") {
			// If marketplace is disabled and we're on marketplace tab, switch to installed
			setActiveTab("installed")
		}
	}, [mcpMarketplaceEnabled, activeTab])

	useEffect(() => {
		if (mcpMarketplaceEnabled) {
			vscode.postMessage({ type: "silentlyRefreshMcpMarketplace" })
			vscode.postMessage({ type: "fetchLatestMcpServersFromHub" })
		}
	}, [mcpMarketplaceEnabled])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "10px 17px 5px 20px",
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>MCP Servers</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div style={{ flex: 1, overflow: "auto" }}>
				{/* Tabs container */}
				<div
					style={{
						display: "flex",
						gap: "1px",
						padding: "0 20px 0 20px",
						borderBottom: "1px solid var(--vscode-panel-border)",
					}}>
					{mcpMarketplaceEnabled && (
						<TabButton isActive={activeTab === "marketplace"} onClick={() => handleTabChange("marketplace")}>
							Marketplace
						</TabButton>
					)}
					<TabButton isActive={activeTab === "installed"} onClick={() => handleTabChange("installed")}>
						Installed
					</TabButton>
					{/* Remove Status Tab Button */}
				</div>

				{/* Content container */}
				<div style={{ width: "100%" }}>
					{mcpMarketplaceEnabled && activeTab === "marketplace" && <McpMarketplaceView />}
					{activeTab === "installed" && (
						<div style={{ padding: "16px 20px" }}>
							<div
								style={{
									color: "var(--vscode-foreground)",
									fontSize: "13px",
									marginBottom: "16px",
									marginTop: "5px",
								}}>
								The{" "}
								<VSCodeLink href="https://github.com/modelcontextprotocol" style={{ display: "inline" }}>
									Model Context Protocol
								</VSCodeLink>{" "}
								enables communication with locally running MCP servers that provide additional tools and resources
								to extend Cline's capabilities. You can use{" "}
								<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
									community-made servers
								</VSCodeLink>{" "}
								or ask Cline to create new tools specific to your workflow (e.g., "add a tool that gets the latest
								npm docs").{" "}
								<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
									See a demo here.
								</VSCodeLink>
							</div>

							{servers.length > 0 ? (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "10px",
									}}>
									{servers.map((server) => (
										<ServerRow key={server.name} server={server} />
									))}
								</div>
							) : (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										alignItems: "center",
										gap: "12px",
										marginTop: 20,
										marginBottom: 20,
										color: "var(--vscode-descriptionForeground)",
									}}>
									No MCP servers installed
								</div>
							)}

							{/* Settings Section - Updated Buttons */}
							<div
								style={{
									marginBottom: "20px",
									marginTop: 20,
									display: "flex",
									flexDirection: "column",
									gap: "8px",
								}}>
								{/* Button for Global Settings */}
								<VSCodeButton
									appearance="secondary"
									style={{ width: "100%" }}
									onClick={() => {
										vscode.postMessage({ type: "openMcpSettings" }) // Existing message for global
									}}>
									<span className="codicon codicon-globe" style={{ marginRight: "6px" }}></span>
									Configure Global Servers
								</VSCodeButton>

								{/* Button for Local Settings */}
								<VSCodeButton
									appearance="secondary"
									style={{ width: "100%" }}
									onClick={() => {
										vscode.postMessage({ type: "openLocalMcpSettings" }) // New message type
									}}>
									<span className="codicon codicon-folder-opened" style={{ marginRight: "6px" }}></span>
									Configure Local Servers (Project)
								</VSCodeButton>

								{/* Keep Advanced Settings Link */}
								<div style={{ textAlign: "center", marginTop: "5px" }}>
									<VSCodeLink
										onClick={() => {
											vscode.postMessage({
												type: "openExtensionSettings",
												text: "cline.mcp",
											})
										}}
										style={{ fontSize: "12px" }}>
										Advanced MCP Settings
									</VSCodeLink>
								</div>
							</div>
						</div>
					)}
					{/* Remove Status Tab Content */}
				</div>
			</div>
		</div>
	)
}

const StyledTabButton = styled.button<{ isActive: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;

	&:hover {
		color: var(--vscode-foreground);
	}
`

export const TabButton = ({
	children,
	isActive,
	onClick,
}: {
	children: React.ReactNode
	isActive: boolean
	onClick: () => void
}) => (
	<StyledTabButton isActive={isActive} onClick={onClick}>
		{children}
	</StyledTabButton>
)

// --- Styled Components for Inline ServerRow ---

const ServerNameContainer = styled.div`
	display: flex;
	align-items: center;
	gap: 6px; // Space between name and info icon
	flex-shrink: 1;
	overflow: hidden; // Ensure container handles overflow
	margin-right: 4px; // Reduced margin to accommodate status dot
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
	flex-shrink: 0; // Prevent shrinking
`

const InfoIcon = styled.span`
	cursor: help; // Indicate it's informative
	color: var(--vscode-descriptionForeground);
	&:hover {
		color: var(--vscode-foreground);
	}
	flex-shrink: 0; // Prevent shrinking
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

// Using the better toggle switch style from McpView.tsx (already present in McpServerRow)
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

// --- Inline Server Row Component (Restored and Enhanced) ---
const ServerRow = ({ server }: { server: McpServer }) => {
	const { mcpMarketplaceCatalog, autoApprovalSettings } = useExtensionState()

	const [isExpanded, setIsExpanded] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)
	const [isInfoHovering, setIsInfoHovering] = useState(false) // Added state
	const [isSourceHovering, setIsSourceHovering] = useState(false) // Added state

	const getStatusColor = () => {
		switch (server.status) {
			case "connected":
				return "var(--vscode-testing-iconPassed)"
			case "connecting":
				return "var(--vscode-charts-yellow)"
			case "disconnected":
			default:
				return "var(--vscode-testing-iconFailed)"
		}
	}

	const handleRowClick = () => {
		if (!server.error) {
			setIsExpanded(!isExpanded)
		}
	}

	const [timeoutValue, setTimeoutValue] = useState<string>(() => {
		try {
			const config = JSON.parse(server.config)
			return config.timeout?.toString() || DEFAULT_MCP_TIMEOUT_SECONDS.toString()
		} catch {
			return DEFAULT_MCP_TIMEOUT_SECONDS.toString()
		}
	})

	const timeoutOptions = [
		{ value: "30", label: "30 seconds" },
		{ value: "60", label: "1 minute" },
		{ value: "300", label: "5 minutes" },
		{ value: "600", label: "10 minutes" },
		{ value: "1800", label: "30 minutes" },
		{ value: "3600", label: "1 hour" },
	]

	const handleTimeoutChange = (e: any) => {
		const select = e.target as HTMLSelectElement
		const value = select.value
		const num = parseInt(value)
		setTimeoutValue(value)
		vscode.postMessage({
			type: "updateMcpTimeout",
			serverName: server.name,
			timeout: num,
		})
	}

	const handleRestart = () => {
		vscode.postMessage({
			type: "restartMcpServer",
			text: server.name,
		})
	}

	const handleDelete = () => {
		setIsDeleting(true)
		vscode.postMessage({
			type: "deleteMcpServer",
			serverName: server.name,
		})
	}

	const handleToggle = useCallback(() => {
		// Use the specific message type for toggling
		vscode.postMessage({
			type: "toggleMcpServer",
			serverName: server.name,
			disabled: !server.disabled,
		})
	}, [server.name, server.disabled])

	const handleAutoApproveChange = () => {
		if (!server.name) return

		vscode.postMessage({
			type: "toggleToolAutoApprove",
			serverName: server.name,
			toolNames: server.tools?.map((tool) => tool.name) || [],
			autoApprove: !server.tools?.every((tool) => tool.autoApprove),
		})
	}

	// Generate Tooltip Text for Info Icon
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
		<div style={{ marginBottom: "10px" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "8px",
					background: "var(--vscode-textCodeBlock-background)",
					cursor: server.error ? "default" : "pointer",
					borderRadius: isExpanded || server.error ? "4px 4px 0 0" : "4px",
					opacity: server.disabled ? 0.6 : 1,
				}}
				onClick={handleRowClick}>
				{!server.error && (
					<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} style={{ marginRight: "8px" }} />
				)}
				<ServerNameContainer>
					<ServerName title={server.name}>{getMcpServerDisplayName(server.name, mcpMarketplaceCatalog)}</ServerName>
					{/* Add Source Indicator with its own Tooltip */}
					{server.source && (
						<Tooltip visible={isSourceHovering} tipText={`Defined in ${server.source} settings`} hintText="">
							<SourceIndicator
								onMouseEnter={() => setIsSourceHovering(true)}
								onMouseLeave={() => setIsSourceHovering(false)}>
								({server.source === MCP_SOURCE_PROJECT ? "project" : "global"}) {/* Use constant */}
							</SourceIndicator>
						</Tooltip>
					)}
					{/* Add Info Icon with its own Tooltip */}
					<Tooltip visible={isInfoHovering} tipText={tooltipText} hintText="">
						<InfoIcon
							className="codicon codicon-info"
							onMouseEnter={() => setIsInfoHovering(true)}
							onMouseLeave={() => setIsInfoHovering(false)}
						/>
					</Tooltip>
				</ServerNameContainer>

				{/* Spacer to push actions to the right */}
				<div style={{ flexGrow: 1 }}></div>

				{/* Collapsed view controls */}
				<div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "8px", flexShrink: 0 }}>
					{!server.error && (
						<>
							<VSCodeButton
								appearance="icon"
								title="Restart Server"
								onClick={(e) => {
									e.stopPropagation()
									handleRestart()
								}}
								disabled={server.status === "connecting"}>
								<span className="codicon codicon-sync"></span>
							</VSCodeButton>
							<VSCodeButton
								appearance="icon"
								title="Delete Server"
								onClick={(e) => {
									e.stopPropagation()
									handleDelete()
								}}
								disabled={isDeleting}>
								<span className="codicon codicon-trash"></span>
							</VSCodeButton>
						</>
					)}
					{/* Toggle Switch */}
					<ToggleSwitchContainer
						role="switch"
						aria-checked={!server.disabled}
						tabIndex={0}
						title={server.disabled ? "Enable Server" : "Disable Server"}
						onClick={(e) => {
							e.stopPropagation() // Prevent row click/expansion
							handleToggle()
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								e.stopPropagation()
								handleToggle()
							}
						}}>
						<ToggleSwitchBody checked={!server.disabled} disabled={false}>
							<ToggleSwitchThumb checked={!server.disabled} />
						</ToggleSwitchBody>
					</ToggleSwitchContainer>
					{/* Status Dot */}
					<StatusDot status={server.status} />
				</div>
			</div>

			{server.error ? (
				<div
					style={{
						fontSize: "13px",
						background: "var(--vscode-textCodeBlock-background)",
						borderRadius: "0 0 4px 4px",
						width: "100%",
					}}>
					<div
						style={{
							color: "var(--vscode-testing-iconFailed)",
							marginBottom: "8px",
							padding: "8px 10px 0 10px", // Added top padding
							overflowWrap: "break-word",
							wordBreak: "break-word",
							whiteSpace: "pre-wrap", // Ensure errors wrap
						}}>
						{server.error}
					</div>
					<VSCodeButton
						appearance="secondary"
						onClick={handleRestart}
						disabled={server.status === "connecting"}
						style={{
							width: "calc(100% - 20px)",
							margin: "0 10px 10px 10px",
						}}>
						{server.status === "connecting" ? "Retrying..." : "Retry Connection"}
					</VSCodeButton>

					<DangerButton
						style={{ width: "calc(100% - 20px)", margin: "0 10px 10px 10px" }}
						disabled={isDeleting}
						onClick={handleDelete}>
						{isDeleting ? "Deleting..." : "Delete Server"}
					</DangerButton>
				</div>
			) : (
				isExpanded && (
					<div
						style={{
							background: "var(--vscode-textCodeBlock-background)",
							padding: "0 10px 10px 10px",
							fontSize: "13px",
							borderRadius: "0 0 4px 4px",
						}}>
						<VSCodePanels>
							<VSCodePanelTab id="tools">Tools ({server.tools?.length || 0})</VSCodePanelTab>
							<VSCodePanelTab id="resources">
								Resources ({[...(server.resourceTemplates || []), ...(server.resources || [])].length || 0})
							</VSCodePanelTab>

							<VSCodePanelView id="tools-view">
								{server.tools && server.tools.length > 0 ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "8px",
											width: "100%",
										}}>
										{server.tools.map((tool) => (
											<McpToolRow key={tool.name} tool={tool} serverName={server.name} />
										))}
										{server.name && autoApprovalSettings.enabled && autoApprovalSettings.actions.useMcp && (
											<VSCodeCheckbox
												style={{ marginBottom: -10 }}
												checked={server.tools.every((tool) => tool.autoApprove)}
												onChange={handleAutoApproveChange}
												data-tool="all-tools">
												Auto-approve all tools
											</VSCodeCheckbox>
										)}
									</div>
								) : (
									<div
										style={{
											padding: "10px 0",
											color: "var(--vscode-descriptionForeground)",
										}}>
										No tools found
									</div>
								)}
							</VSCodePanelView>

							<VSCodePanelView id="resources-view">
								{(server.resources && server.resources.length > 0) ||
								(server.resourceTemplates && server.resourceTemplates.length > 0) ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "8px",
											width: "100%",
										}}>
										{[...(server.resourceTemplates || []), ...(server.resources || [])].map((item) => (
											<McpResourceRow
												key={"uriTemplate" in item ? item.uriTemplate : item.uri}
												item={item}
											/>
										))}
									</div>
								) : (
									<div
										style={{
											padding: "10px 0",
											color: "var(--vscode-descriptionForeground)",
										}}>
										No resources found
									</div>
								)}
							</VSCodePanelView>
						</VSCodePanels>

						<div style={{ margin: "10px 7px" }}>
							<label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>Request Timeout</label>
							<VSCodeDropdown style={{ width: "100%" }} value={timeoutValue} onChange={handleTimeoutChange}>
								{timeoutOptions.map((option) => (
									<VSCodeOption key={option.value} value={option.value}>
										{option.label}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						</div>
						<VSCodeButton
							appearance="secondary"
							onClick={handleRestart}
							disabled={server.status === "connecting"}
							style={{
								width: "calc(100% - 14px)",
								margin: "0 7px 3px 7px",
							}}>
							{server.status === "connecting" ? "Restarting..." : "Restart Server"}
						</VSCodeButton>

						<DangerButton
							style={{ width: "calc(100% - 14px)", margin: "5px 7px 3px 7px" }}
							disabled={isDeleting}
							onClick={handleDelete}>
							{isDeleting ? "Deleting..." : "Delete Server"}
						</DangerButton>
					</div>
				)
			)}
		</div>
	)
}
