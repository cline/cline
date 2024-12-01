import {
	VSCodeButton,
	VSCodeDivider,
	VSCodeTextArea,
	VSCodeTextField,
	VSCodeTag,
	VSCodePanelTab,
	VSCodePanelView,
	VSCodeDataGrid,
	VSCodeDataGridRow,
	VSCodeDataGridCell,
	VSCodePanels,
} from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"

type McpServer = {
	name: string
	config: string // JSON config
	status: "connected" | "connecting" | "disconnected"
	error?: string
	tools?: any[] // We'll type this properly later
	resources?: any[] // We'll type this properly later
}

type McpViewProps = {
	onDone: () => void
}

const McpView = ({ onDone }: McpViewProps) => {
	const [isAdding, setIsAdding] = useState(false)
	const [servers, setServers] = useState<McpServer[]>([
		// Add some mock servers for testing
		{
			name: "local-tools",
			config: JSON.stringify({
				mcpServers: {
					"local-tools": {
						command: "npx",
						args: ["-y", "@modelcontextprotocol/server-tools"],
					},
				},
			}),
			status: "connected",
			tools: [
				{
					name: "execute_command",
					description: "Run a shell command on the local system",
				},
				{
					name: "read_file",
					description: "Read contents of a file from the filesystem",
				},
			],
		},
		{
			name: "postgres-db",
			config: JSON.stringify({
				mcpServers: {
					"postgres-db": {
						command: "npx",
						args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
					},
				},
			}),
			status: "disconnected",
			error: "Failed to connect to database: Connection refused",
		},
		{
			name: "github-tools",
			config: JSON.stringify({
				mcpServers: {
					"github-tools": {
						command: "npx",
						args: ["-y", "@modelcontextprotocol/server-github"],
					},
				},
			}),
			status: "connecting",
			resources: [
				{
					uri: "github://repo/issues",
					name: "Repository Issues",
				},
				{
					uri: "github://repo/pulls",
					name: "Pull Requests",
				},
			],
		},
	])
	const [configInput, setConfigInput] = useState("")

	const handleAddServer = () => {
		try {
			const config = JSON.parse(configInput)
			const serverName = Object.keys(config.mcpServers)[0]

			setServers((prev) => [
				...prev,
				{
					name: serverName,
					config: configInput,
					status: "connecting",
				},
			])

			setIsAdding(false)
			setConfigInput("")

			// Here you would trigger the actual server connection
			// and update its status/tools/resources accordingly
		} catch (e) {
			// Handle invalid JSON
			console.error("Invalid server configuration:", e)
		}
	}

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
				overflow: "hidden",
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
			<p style={{ padding: "0 20px", color: "var(--vscode-foreground)", fontSize: "13px" }}>
				MCP (Model Context Protocol) enables AI models to access external tools and data through standardized
				interfaces. Add MCP servers to extend Claude's capabilities with custom functionality and real-time data
				access.
			</p>

			{/* Server List */}
			<div style={{ flex: 1, overflow: "auto", padding: "0 20px" }}>
				{servers.map((server) => (
					<ServerRow key={server.name} server={server} />
				))}
			</div>

			{/* Add Server UI */}
			<div style={{ padding: "20px" }}>
				{isAdding ? (
					<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
						<VSCodeTextArea
							rows={4}
							placeholder='{"mcpServers": {"server-name": {"command": "...", "args": [...]}}}'
							value={configInput}
							onChange={(e) => setConfigInput((e.target as HTMLTextAreaElement).value)}
						/>
						<div style={{ display: "flex", gap: "10px" }}>
							<VSCodeButton style={{ flex: 1 }} onClick={handleAddServer}>
								Add Server
							</VSCodeButton>
							<VSCodeButton style={{ flex: 1 }} appearance="secondary" onClick={() => setIsAdding(false)}>
								Cancel
							</VSCodeButton>
						</div>
					</div>
				) : (
					<VSCodeButton style={{ width: "100%" }} onClick={() => setIsAdding(true)}>
						<span className="codicon codicon-add" style={{ marginRight: "6px" }}></span>
						Add MCP Server
					</VSCodeButton>
				)}
			</div>
		</div>
	)
}

// Server Row Component
const ServerRow = ({ server }: { server: McpServer }) => {
	const [isExpanded, setIsExpanded] = useState(false)
	const [isEditing, setIsEditing] = useState(false)
	const [editConfig, setEditConfig] = useState(server.config)

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

	const handleSaveConfig = () => {
		try {
			JSON.parse(editConfig) // Validate JSON
			// Here you would update the server config
			setIsEditing(false)
		} catch (e) {
			console.error("Invalid JSON config:", e)
		}
	}

	// Don't allow expansion if server has error
	const handleRowClick = () => {
		if (!server.error) {
			setIsExpanded(!isExpanded)
		}
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
						color: "var(--vscode-testing-iconFailed)",
						background: "var(--vscode-list-hoverBackground)",
						borderRadius: "0 0 4px 4px",
					}}>
					{server.error}
				</div>
			) : (
				isExpanded && (
					<div
						style={{
							background: "var(--vscode-list-hoverBackground)",
							padding: "0 12px 12px 12px",
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

						{/* Edit/Remove Buttons */}
						<div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "0px" }}>
							{isEditing ? (
								<>
									<VSCodeTextArea
										value={editConfig}
										onChange={(e) => setEditConfig((e.target as HTMLTextAreaElement).value)}
										style={{ width: "100%" }}
									/>
									<div style={{ display: "flex", gap: "8px" }}>
										<VSCodeButton onClick={handleSaveConfig} style={{ flex: 1 }}>
											Save
										</VSCodeButton>
										<VSCodeButton
											appearance="secondary"
											onClick={() => setIsEditing(false)}
											style={{ flex: 1 }}>
											Cancel
										</VSCodeButton>
									</div>
								</>
							) : (
								<div style={{ display: "flex", gap: "8px" }}>
									<VSCodeButton
										appearance="secondary"
										onClick={() => setIsEditing(true)}
										style={{ flex: 1 }}>
										Edit
									</VSCodeButton>
									<VSCodeButton
										appearance="secondary"
										style={{
											flex: 1,
										}}>
										Remove
									</VSCodeButton>
								</div>
							)}
						</div>
					</div>
				)
			)}
		</div>
	)
}

export default McpView
