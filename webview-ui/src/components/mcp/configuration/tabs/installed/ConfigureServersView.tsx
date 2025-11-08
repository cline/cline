import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient, UiServiceClient } from "@/services/grpc-client"
import ServersToggleList from "./ServersToggleList"

const ConfigureServersView = () => {
	const { t } = useTranslation()
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
				{t("mcp.configure.description_part1", "The")}{" "}
				<VSCodeLink href="https://github.com/modelcontextprotocol" style={{ display: "inline" }}>
					{t("mcp.configure.model_context_protocol", "Model Context Protocol")}
				</VSCodeLink>{" "}
				{t(
					"mcp.configure.description_part2",
					"enables communication with locally running MCP servers that provide additional tools and resources to extend Cline's capabilities. You can use",
				)}{" "}
				<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
					{t("mcp.configure.community_servers", "community-made servers")}
				</VSCodeLink>{" "}
				{t(
					"mcp.configure.description_part3",
					'or ask Cline to create new tools specific to your workflow (e.g., "add a tool that gets the latest npm docs").',
				)}{" "}
				<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
					{t("mcp.configure.see_demo", "See a demo here.")}
				</VSCodeLink>
			</div>

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
					{t("mcp.configure.configure_mcp_servers", "Configure MCP Servers")}
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
						{t("mcp.configure.advanced_settings", "Advanced MCP Settings")}
					</VSCodeLink>
				</div>
			</div>
		</div>
	)
}

export default ConfigureServersView
