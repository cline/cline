import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import ServersToggleList from "./ServersToggleList"

const ConfigureServersView = () => {
	const { t } = useTranslation()
	const { mcpServers: servers, navigateToSettings, remoteConfigSettings } = useExtensionState()

	// Check if there are remote MCP servers configured
	const hasRemoteMCPServers = remoteConfigSettings?.remoteMCPServers && remoteConfigSettings.remoteMCPServers.length > 0

	return (
		<div style={{ padding: "16px 20px" }}>
			<div
				style={{
					color: "var(--vscode-foreground)",
					fontSize: "13px",
					marginBottom: "16px",
					marginTop: "5px",
				}}>
				<VSCodeLink href="https://github.com/modelcontextprotocol" style={{ display: "inline" }}>
					{t("mcp.configureServers.modelContextProtocol")}
				</VSCodeLink>
				{t("mcp.configureServers.mcpDescription")}{" "}
				<VSCodeLink href="https://github.com/modelcontextprotocol/servers" style={{ display: "inline" }}>
					{t("mcp.configureServers.communityServers")}
				</VSCodeLink>
				{t("mcp.configureServers.askCline")}{" "}
				<VSCodeLink href="https://x.com/sdrzn/status/1867271665086074969" style={{ display: "inline" }}>
					{t("mcp.configureServers.seeDemo")}
				</VSCodeLink>
			</div>

			{/* Remote config banner */}
			{hasRemoteMCPServers && (
				<div className="flex items-center gap-2 px-5 py-3 mb-4 bg-vscode-textBlockQuote-background border-l-[3px] border-vscode-textLink-foreground">
					<i className="codicon codicon-lock text-sm" />
					<span className="text-base">{t("mcp.configureServers.orgManagesServers")}</span>
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
					{t("mcp.configureServers.configureMcpServers")}
				</VSCodeButton>

				<div style={{ textAlign: "center" }}>
					<VSCodeLink onClick={() => navigateToSettings("features")} style={{ fontSize: "12px" }}>
						{t("mcp.configureServers.advancedSettings")}
					</VSCodeLink>
				</div>
			</div>
		</div>
	)
}

export default ConfigureServersView
