import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import { vscode } from "@/utils/vscode"
import { McpViewTab } from "@shared/mcp"
import { EmptyRequest } from "@shared/proto/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import styled from "styled-components"
import AddRemoteServerForm from "./tabs/add-server/AddRemoteServerForm"
import InstalledServersView from "./tabs/installed/InstalledServersView"
import McpMarketplaceView from "./tabs/marketplace/McpMarketplaceView"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { McpServers } from "@shared/proto/mcp"

type McpViewProps = {
	onDone: () => void
	initialTab?: McpViewTab
}

const McpConfigurationView = ({ onDone, initialTab }: McpViewProps) => {
	const { mcpMarketplaceEnabled, setMcpServers } = useExtensionState()
	const [activeTab, setActiveTab] = useState<McpViewTab>(initialTab || (mcpMarketplaceEnabled ? "marketplace" : "installed"))

	const handleTabChange = (tab: McpViewTab) => {
		setActiveTab(tab)
	}

	useEffect(() => {
		if (!mcpMarketplaceEnabled && activeTab === "marketplace") {
			// If marketplace is disabled and we're on marketplace tab, switch to installed
			setActiveTab("installed")
		}
	}, [mcpMarketplaceEnabled, activeTab])

	// Get setter for MCP marketplace catalog from context
	const { setMcpMarketplaceCatalog } = useExtensionState()

	useEffect(() => {
		if (mcpMarketplaceEnabled) {
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
					<TabButton isActive={activeTab === "addRemote"} onClick={() => handleTabChange("addRemote")}>
						Remote Servers
					</TabButton>
					<TabButton isActive={activeTab === "installed"} onClick={() => handleTabChange("installed")}>
						Installed
					</TabButton>
				</div>

				{/* Content container */}
				<div style={{ width: "100%" }}>
					{mcpMarketplaceEnabled && activeTab === "marketplace" && <McpMarketplaceView />}
					{activeTab === "addRemote" && <AddRemoteServerForm onServerAdded={() => handleTabChange("installed")} />}
					{activeTab === "installed" && <InstalledServersView />}
				</div>
			</div>
		</div>
	)
}

const StyledTabButton = styled.button<{ isActive: boolean; disabled?: boolean }>`
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
	<StyledTabButton isActive={isActive} onClick={onClick} disabled={disabled} style={style}>
		{children}
	</StyledTabButton>
)

export default McpConfigurationView
