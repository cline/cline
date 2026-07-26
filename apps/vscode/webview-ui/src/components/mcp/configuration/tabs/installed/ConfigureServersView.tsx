import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import ServersToggleList from "./ServersToggleList"

const ConfigureServersView = () => {
	const { mcpServers: servers, navigateToSettings, remoteConfigSettings, mcpServerState } = useExtensionState()
	const vscode = typeof window !== "undefined" ? (window as any).__clineVsCodeApi : null

	// Check if there are remote MCP servers configured
	const hasRemoteMCPServers = remoteConfigSettings?.remoteMCPServers && remoteConfigSettings.remoteMCPServers.length > 0

	return (
		<div style={{ padding: "16px 20px" }}>
			{/* External Agent MCP Server Host Card */}
			<div
				style={{
					background: "var(--vscode-editor-background)",
					border: "1px solid var(--vscode-widget-border, rgba(255,255,255,0.15))",
					borderRadius: "6px",
					padding: "14px 16px",
					marginBottom: "20px",
				}}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<span
							className="codicon codicon-radio-tower"
							style={{
								fontSize: "16px",
								color: mcpServerState?.active ? "#4ec9b0" : "var(--vscode-descriptionForeground)",
							}}
						/>
						<span style={{ fontWeight: 600, fontSize: "13px" }}>External Agent MCP Host</span>
						<span
							style={{
								fontSize: "10px",
								padding: "2px 6px",
								borderRadius: "10px",
								background: mcpServerState?.active ? "rgba(78, 201, 176, 0.2)" : "rgba(255, 255, 255, 0.1)",
								color: mcpServerState?.active ? "#4ec9b0" : "var(--vscode-descriptionForeground)",
								fontWeight: 600,
							}}>
							{mcpServerState?.active ? "ACTIVE" : "OFF"}
						</span>
					</div>
					<VSCodeButton
						appearance={mcpServerState?.active ? "secondary" : "primary"}
						onClick={() => vscode?.postMessage({ type: "toggleMcpServer" })}>
						{mcpServerState?.active ? "Stop Server" : "Start Server"}
					</VSCodeButton>
				</div>

				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "0 0 10px 0", lineHeight: "1.4" }}>
					Exposes Cline workspace tools directly to external agents (Hermes, OpenClaw, AutoGPT, Python SDK) via MCP over HTTP.
				</p>

				{mcpServerState?.active && (
					<div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--vscode-panel-border)" }}>
						<div>
							<div style={{ fontSize: "11px", color: "var(--vscode-descriptionForeground)", marginBottom: "4px" }}>
								Local MCP Endpoint (HTTP / JSON-RPC 2.0):
							</div>
							<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
								<code style={{ flex: 1, padding: "6px 10px", background: "var(--vscode-textCodeBlock-background)", borderRadius: "4px", fontSize: "12px", color: "#4ec9b0" }}>
									http://127.0.0.1:{mcpServerState.port || 3000}/mcp
								</code>
								<VSCodeButton
									appearance="icon"
									title="Copy Endpoint URL"
									onClick={() => navigator.clipboard.writeText(`http://127.0.0.1:${mcpServerState.port || 3000}/mcp`)}>
									<span className="codicon codicon-copy" />
								</VSCodeButton>
							</div>
						</div>
					</div>
				)}
			</div>

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

			{/* Remote config banner */}
			{hasRemoteMCPServers && (
				<div className="flex items-center gap-2 px-5 py-3 mb-4 bg-vscode-textBlockQuote-background border-l-[3px] border-vscode-textLink-foreground">
					<i className="codicon codicon-lock text-sm" />
					<span className="text-base">Your organization manages some MCP servers</span>
				</div>
			)}

			<ServersToggleList hasTrashIcon={false} isExpandable={true} servers={servers} />

			{/* Settings Section */}
			<div style={{ marginBottom: "20px", marginTop: 10 }}>
				<VSCodeButton
					appearance="secondary"
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}
					style={{ width: "100%", marginBottom: "5px" }}>
					<span className="codicon codicon-server" style={{ marginRight: "6px" }}></span>
					Configure MCP Servers
				</VSCodeButton>

				<div style={{ textAlign: "center" }}>
					<VSCodeLink onClick={() => navigateToSettings("features")} style={{ fontSize: "12px" }}>
						Advanced MCP Settings
					</VSCodeLink>
				</div>
			</div>
		</div>
	)
}

export default ConfigureServersView
