import { useExtensionState } from "@/context/ExtensionStateContext"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { McpServiceClient, UiServiceClient } from "@/services/grpc-client"

import { EmptyRequest, StringRequest } from "@shared/proto/common"
import ServersToggleList from "./ServersToggleList"
const InstalledServersView = () => {
	const { mcpServers: servers, navigateToSettings } = useExtensionState()

	return (
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

			<ServersToggleList servers={servers} isExpandable={true} hasTrashIcon={false} />

			{/* Settings Section */}
			<div style={{ marginBottom: "20px", marginTop: 10 }}>
				<VSCodeButton
					appearance="secondary"
					style={{ width: "100%", marginBottom: "5px" }}
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}>
					<span className="codicon codicon-server" style={{ marginRight: "6px" }}></span>
					Configure MCP Servers
				</VSCodeButton>

				<div style={{ textAlign: "center" }}>
					<VSCodeLink
						onClick={() => {
							// First open the settings panel using direct navigation
							navigateToSettings()

							// After a short delay, send a message to scroll to browser settings
							setTimeout(async () => {
								try {
									await UiServiceClient.scrollToSettings(StringRequest.create({ value: "features" }))
								} catch (error) {
									console.error("Error scrolling to mcp settings:", error)
								}
							}, 300)
						}}
						style={{ fontSize: "12px" }}>
						Advanced MCP Settings
					</VSCodeLink>
				</div>
			</div>
		</div>
	)
}

export default InstalledServersView
