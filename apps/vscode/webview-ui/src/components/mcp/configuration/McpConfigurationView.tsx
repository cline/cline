import { McpViewTab } from "@shared/mcp"
import { EmptyRequest } from "@shared/proto/bedrock_coder/common"
import { McpServers } from "@shared/proto/bedrock_coder/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { useEffect } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import ViewHeader from "../../common/ViewHeader"
import ConfigureServersView from "./tabs/installed/ConfigureServersView"

type McpViewProps = {
	onDone: () => void
	initialTab?: McpViewTab
}

const McpConfigurationView = ({ onDone }: McpViewProps) => {
	const { setMcpServers, environment } = useExtensionState()

	useEffect(() => {
		McpServiceClient.getLatestMcpServers(EmptyRequest.create({}))
			.then((response: McpServers) => {
				if (response.mcpServers) {
					const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
					setMcpServers(mcpServers)
				}
			})
			.catch((error) => {
				console.error("Failed to fetch MCP servers:", error)
			})
	}, [setMcpServers])

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
			<ViewHeader environment={environment} onDone={onDone} title="MCP Servers" />

			<div style={{ flex: 1, overflow: "auto" }}>
				<div style={{ padding: "10px 20px", color: "var(--vscode-descriptionForeground)" }}>
					Corporate-safe mode permits only explicitly configured local stdio MCP servers. Remote HTTP, SSE, WebSocket,
					OAuth, hosted discovery, and automatic package downloads are disabled.
				</div>
				<div style={{ width: "100%" }}>
					<ConfigureServersView />
				</div>
			</div>
		</div>
	)
}

export default McpConfigurationView
