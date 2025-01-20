import {
	VSCodeButton,
	VSCodeLink,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
	VSCodeCheckbox,
} from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { McpServer } from "../../../../src/shared/mcp"
import McpToolRow from "./McpToolRow"
import McpResourceRow from "./McpResourceRow"

type McpViewProps = {
	onDone: () => void
}

const McpView = ({ onDone }: McpViewProps) => {
	const { mcpServers: servers } = useExtensionState()
	const [isMcpEnabled, setIsMcpEnabled] = useState(true)

	useEffect(() => {
		// Get initial MCP enabled state
		vscode.postMessage({ type: "getMcpEnabled" })
	}, [])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "mcpEnabled") {
				setIsMcpEnabled(message.enabled)
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	const toggleMcp = () => {
		vscode.postMessage({
			type: "toggleMcp",
			enabled: !isMcpEnabled,
		})
		setIsMcpEnabled(!isMcpEnabled)
	}
	// const [servers, setServers] = useState<McpServer[]>([
	// 	// Add some mock servers for testing
	// 	{
	// 		name: "local-tools",
	// 		config: JSON.stringify({
	// 			mcpServers: {
	// 				"local-tools": {
	// 					command: "npx",
	// 					args: ["-y", "@modelcontextprotocol/server-tools"],
	// 				},
	// 			},
	// 		}),
	// 		status: "connected",
	// 		tools: [
	// 			{
	// 				name: "execute_command",
	// 				description: "Run a shell command on the local system",
	// 			},
	// 			{
	// 				name: "read_file",
	// 				description: "Read contents of a file from the filesystem",
	// 			},
	// 		],
	// 	},
	// 	{
	// 		name: "postgres-db",
	// 		config: JSON.stringify({
	// 			mcpServers: {
	// 				"postgres-db": {
	// 					command: "npx",
	// 					args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
	// 				},
	// 			},
	// 		}),
	// 		status: "disconnected",
	// 		error: "Failed to connect to database: Connection refused",
	// 	},
	// 	{
	// 		name: "github-tools",
	// 		config: JSON.stringify({
	// 			mcpServers: {
	// 				"github-tools": {
	// 					command: "npx",
	// 					args: ["-y", "@modelcontextprotocol/server-github"],
	// 				},
	// 			},
	// 		}),
	// 		status: "connecting",
	// 		resources: [
	// 			{
	// 				uri: "github://repo/issues",
	// 				name: "Repository Issues",
	// 			},
	// 			{
	// 				uri: "github://repo/pulls",
	// 				name: "Pull Requests",
	// 			},
	// 		],
	// 	},
	// ])

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
					padding: "10px 17px 10px 20px",
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>MCP Servers</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div style={{ flex: 1, overflow: "auto", padding: "0 20px" }}>
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
					enables communication with locally running MCP servers that provide additional tools and resources to extend
					Cline's capabilities. You can use{" "}
					<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
						community-made servers
					</VSCodeLink>{" "}
					or ask Cline to create new tools specific to your workflow (e.g., "add a tool that gets the latest npm docs").{" "}
					<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
						See a demo here.
					</VSCodeLink>
				</div>

				{/* MCP Toggle Section */}
				<div
					style={{
						marginBottom: "16px",
						paddingBottom: "16px",
						borderBottom: "1px solid var(--vscode-textSeparator-foreground)",
					}}>
					<div>
						<VSCodeCheckbox
							checked={isMcpEnabled}
							onChange={toggleMcp}
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "4px 0",
								cursor: "pointer",
								fontSize: "13px",
							}}>
							Enable MCP
						</VSCodeCheckbox>
						{isMcpEnabled && (
							<div
								style={{
									marginTop: "4px",
									marginLeft: "24px",
									color: "var(--vscode-descriptionForeground)",
									fontSize: "12px",
								}}>
								Disabling MCP will save on tokens passed in the context.
							</div>
						)}
						{!isMcpEnabled && (
							<div
								style={{
									padding: "8px 12px",
									marginTop: "8px",
									background: "var(--vscode-textBlockQuote-background)",
									border: "1px solid var(--vscode-textBlockQuote-border)",
									borderRadius: "4px",
									color: "var(--vscode-descriptionForeground)",
									fontSize: "12px",
									lineHeight: "1.4",
								}}>
								MCP is currently disabled. Enable MCP to use MCP servers and tools. Enabling MCP will use
								additional tokens.
							</div>
						)}
					</div>
				</div>

				{servers.length > 0 && isMcpEnabled && (
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
				)}

				{/* Server Configuration Button */}
				{isMcpEnabled && (
					<div style={{ marginTop: "10px", width: "100%" }}>
						<VSCodeButton
							appearance="secondary"
							style={{ width: "100%" }}
							onClick={() => {
								vscode.postMessage({ type: "openMcpSettings" })
							}}>
							<span className="codicon codicon-server" style={{ marginRight: "6px" }}></span>
							Configure MCP Servers
						</VSCodeButton>
					</div>
				)}

				{/* Bottom padding */}
				<div style={{ height: "20px" }} />
			</div>
		</div>
	)
}

// Server Row Component
const ServerRow = ({ server }: { server: McpServer }) => {
	const [isExpanded, setIsExpanded] = useState(false)

	const getStatusColor = () => {
		switch (server.status) {
			case "connected":
				return "var(--vscode-testing-iconPassed)"
			case "connecting":
				return "var(--vscode-charts-yellow)"
			case "disconnected":
				return "var(--vscode-testing-iconFailed)"
		}
	}

	const handleRowClick = () => {
		if (!server.error) {
			setIsExpanded(!isExpanded)
		}
	}

	const handleRestart = () => {
		vscode.postMessage({
			type: "restartMcpServer",
			text: server.name,
		})
	}

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
				}}
				onClick={handleRowClick}>
				{!server.error && (
					<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} style={{ marginRight: "8px" }} />
				)}
				<span style={{ flex: 1 }}>{server.name}</span>
				<div
					style={{
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						background: getStatusColor(),
						marginLeft: "8px",
					}}
				/>
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
							padding: "0 10px",
							overflowWrap: "break-word",
							wordBreak: "break-word",
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
											<McpToolRow key={tool.name} tool={tool} />
										))}
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
					</div>
				)
			)}
		</div>
	)
}

export default McpView
