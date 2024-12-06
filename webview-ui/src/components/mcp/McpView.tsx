import { VSCodeButton, VSCodePanels, VSCodePanelTab, VSCodePanelView } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { vscode } from "../../utils/vscode"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { McpServer } from "../../../../src/shared/mcp"

type McpViewProps = {
	onDone: () => void
}

const McpView = ({ onDone }: McpViewProps) => {
	const { mcpServers: servers } = useExtensionState()
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
				<p style={{ color: "var(--vscode-foreground)", fontSize: "13px" }}>
					MCP (Model Context Protocol) enables AI models to access external tools and data through
					standardized interfaces. These MCP servers extend Claude's capabilities with custom functionality
					and real-time data access.
				</p>

				{/* Server List */}
				<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
					{servers.map((server) => (
						<ServerRow key={server.name} server={server} />
					))}
				</div>

				{/* Edit Settings Button */}
				<div style={{ marginTop: "10px", width: "100%" }}>
					<VSCodeButton
						appearance="secondary"
						style={{ width: "100%" }}
						onClick={() => {
							vscode.postMessage({ type: "openMcpSettings" })
						}}>
						<span className="codicon codicon-edit" style={{ marginRight: "6px" }}></span>
						Edit MCP Settings
					</VSCodeButton>
				</div>

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

	const handleRetry = () => {
		vscode.postMessage({
			type: "retryMcpServer",
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
					background: "var(--vscode-list-hoverBackground)",
					cursor: server.error ? "default" : "pointer",
					borderRadius: isExpanded || server.error ? "4px 4px 0 0" : "4px",
				}}
				onClick={handleRowClick}>
				{!server.error && (
					<span
						className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
						style={{ marginRight: "8px" }}
					/>
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
						padding: "8px",
						fontSize: "13px",
						background: "var(--vscode-list-hoverBackground)",
						borderRadius: "0 0 4px 4px",
					}}>
					<div style={{ color: "var(--vscode-testing-iconFailed)", marginBottom: "8px" }}>{server.error}</div>
					<VSCodeButton appearance="secondary" onClick={handleRetry}>
						<span className="codicon codicon-debug-restart" style={{ marginRight: "6px" }}></span>
						Retry Connection
					</VSCodeButton>
				</div>
			) : (
				isExpanded && (
					<div
						style={{
							background: "var(--vscode-list-hoverBackground)",
							padding: "0 12px 0 12px",
							fontSize: "13px",
							borderRadius: "0 0 4px 4px",
						}}>
						<VSCodePanels>
							<VSCodePanelTab id="tools">Tools ({server.tools?.length || 0})</VSCodePanelTab>
							<VSCodePanelTab id="resources">Resources ({server.resources?.length || 0})</VSCodePanelTab>

							<VSCodePanelView id="tools-view">
								{server.tools && server.tools.length > 0 ? (
									<div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
										{server.tools.map((tool) => (
											<div
												key={tool.name}
												style={{
													padding: "8px 0",
												}}>
												<div style={{ display: "flex" }}>
													<span
														className="codicon codicon-symbol-method"
														style={{ marginRight: "6px" }}></span>
													<span style={{ fontWeight: 500 }}>{tool.name}</span>
												</div>
												<div
													style={{
														marginLeft: "0px",
														marginTop: "4px",
														opacity: 0.8,
														fontSize: "12px",
													}}>
													{tool.description}
												</div>
											</div>
										))}
									</div>
								) : (
									<div style={{ padding: "10px 0", color: "var(--vscode-descriptionForeground)" }}>
										No tools found
									</div>
								)}
							</VSCodePanelView>

							{/* Resources Panel View */}
							<VSCodePanelView id="resources-view">
								{server.resources && server.resources.length > 0 ? (
									<div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
										{server.resources.map((resource) => (
											<div
												key={resource.uri}
												style={{
													padding: "8px 0",
												}}>
												<div style={{ display: "flex" }}>
													<span
														className="codicon codicon-symbol-file"
														style={{ marginRight: "6px" }}></span>
													<span style={{ fontWeight: 500 }}>{resource.name}</span>
												</div>
												<div style={{ marginTop: "6px", fontSize: "12px" }}>
													<code
														style={{
															color: "var(--vscode-textPreformat-foreground)",
															background: "var(--vscode-textPreformat-background)",
															padding: "2px 4px",
															borderRadius: "3px",
														}}>
														{resource.uri}
													</code>
												</div>
											</div>
										))}
									</div>
								) : (
									<div style={{ padding: "10px 0", color: "var(--vscode-descriptionForeground)" }}>
										No resources found
									</div>
								)}
							</VSCodePanelView>
						</VSCodePanels>
					</div>
				)
			)}
		</div>
	)
}

export default McpView
