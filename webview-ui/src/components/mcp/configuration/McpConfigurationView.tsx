import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import AddRemoteServerForm from "./tabs/add-server/AddRemoteServerForm"
import McpMarketplaceView from "./tabs/marketplace/McpMarketplaceView"
import InstalledServersView from "./tabs/installed/InstalledServersView"

type McpViewProps = {
	onDone: () => void
}

const McpConfigurationView = ({ onDone }: McpViewProps) => {
	const { mcpMarketplaceEnabled } = useExtensionState()
	const [activeTab, setActiveTab] = useState(mcpMarketplaceEnabled ? "marketplace" : "installed")

	const handleTabChange = (tab: string) => {
		setActiveTab(tab)
	}

	useEffect(() => {
		if (!mcpMarketplaceEnabled && activeTab === "marketplace") {
			// If marketplace is disabled and we're on marketplace tab, switch to installed
			setActiveTab("installed")
		}
	}, [mcpMarketplaceEnabled, activeTab])

	useEffect(() => {
		if (mcpMarketplaceEnabled) {
			vscode.postMessage({ type: "silentlyRefreshMcpMarketplace" })
			vscode.postMessage({ type: "fetchLatestMcpServersFromHub" })
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

const StyledTabButton = styled.button<{ isActive: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;

	&:hover {
		color: var(--vscode-foreground);
	}
`

export const TabButton = ({
	children,
	isActive,
	onClick,
}: {
	children: React.ReactNode
	isActive: boolean
	onClick: () => void
}) => (
	<StyledTabButton isActive={isActive} onClick={onClick}>
		{children}
	</StyledTabButton>
)

export default McpConfigurationView
