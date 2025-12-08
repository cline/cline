import { McpViewTab } from "@shared/mcp"
import { EmptyRequest } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"
import AddRemoteServerForm from "./tabs/add-server/AddRemoteServerForm"
import ConfigureServersView from "./tabs/installed/ConfigureServersView"
import McpMarketplaceView from "./tabs/marketplace/McpMarketplaceView"

type McpViewProps = {
	onDone: () => void
	initialTab?: McpViewTab
}

const McpConfigurationView = ({ onDone, initialTab }: McpViewProps) => {
	const { remoteConfigSettings, setMcpServers, environment } = useExtensionState()
	// Show marketplace by default unless remote config explicitly disables it
	const showMarketplace = remoteConfigSettings?.mcpMarketplaceEnabled !== false
	const [activeTab, setActiveTab] = useState<McpViewTab>(initialTab || (showMarketplace ? "marketplace" : "configure"))

	const handleTabChange = (tab: McpViewTab) => {
		setActiveTab(tab)
	}

	useEffect(() => {
		if (!showMarketplace && activeTab === "marketplace") {
			// If marketplace is disabled by remote config and we're on marketplace tab, switch to configure
			setActiveTab("configure")
		}
	}, [showMarketplace, activeTab])

	// Get setter for MCP marketplace catalog from context
	const { setMcpMarketplaceCatalog } = useExtensionState()

	useEffect(() => {
		if (showMarketplace) {
			McpServiceClient.refreshMcpMarketplace(EmptyRequest.create({}))
				.then((response) => {
					setMcpMarketplaceCatalog(response)
				})
				.catch((error) => {
					console.error("Error refreshing MCP marketplace:", error)
				})

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
		}
	}, [showMarketplace])

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
				<h3
					style={{
						color: getEnvironmentColor(environment),
						margin: 0,
					}}>
					MCP Servers
				</h3>
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
					{showMarketplace && (
						<TabButton isActive={activeTab === "marketplace"} onClick={() => handleTabChange("marketplace")}>
							Marketplace
						</TabButton>
					)}
					<TabButton isActive={activeTab === "addRemote"} onClick={() => handleTabChange("addRemote")}>
						Remote Servers
					</TabButton>
					<TabButton isActive={activeTab === "configure"} onClick={() => handleTabChange("configure")}>
						Configure
					</TabButton>
				</div>

				{/* Content container */}
				<div style={{ width: "100%" }}>
					{showMarketplace && activeTab === "marketplace" && <McpMarketplaceView />}
					{activeTab === "addRemote" && <AddRemoteServerForm onServerAdded={() => handleTabChange("configure")} />}
					{activeTab === "configure" && <ConfigureServersView />}
				</div>
			</div>
		</div>
	)
}

const StyledTabButton = styled.button.withConfig({
	shouldForwardProp: (prop) => !["isActive"].includes(prop),
})<{ isActive: boolean; disabled?: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;
	opacity: ${(props) => (props.disabled ? 0.6 : 1)};
	pointer-events: ${(props) => (props.disabled ? "none" : "auto")};

	&:hover {
		color: ${(props) => (props.disabled ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)")};
	}
`

export const TabButton = ({
	children,
	isActive,
	onClick,
	disabled,
	style,
}: {
	children: React.ReactNode
	isActive: boolean
	onClick: () => void
	disabled?: boolean
	style?: React.CSSProperties
}) => (
	<StyledTabButton disabled={disabled} isActive={isActive} onClick={onClick} style={style}>
		{children}
	</StyledTabButton>
)

export default McpConfigurationView
