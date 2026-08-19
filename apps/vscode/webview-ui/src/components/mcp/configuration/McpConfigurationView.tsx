import { McpViewTab } from "@shared/mcp"
import { EmptyRequest } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { useEffect, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import ViewHeader from "../../common/ViewHeader"
import AddRemoteServerForm from "./tabs/add-server/AddRemoteServerForm"
import ConfigureServersView from "./tabs/installed/ConfigureServersView"

type McpViewProps = {
	onDone: () => void
	initialTab?: McpViewTab
}

const McpConfigurationView = ({ onDone, initialTab }: McpViewProps) => {
	const { remoteConfigSettings, setMcpServers, environment } = useExtensionState()
	const showRemoteServers = remoteConfigSettings?.blockPersonalRemoteMCPServers !== true
	const [activeTab, setActiveTab] = useState<McpViewTab>(initialTab || "configure")

	const handleTabChange = (tab: McpViewTab) => {
		setActiveTab(tab)
	}

	useEffect(() => {
		if (!showRemoteServers && activeTab === "addRemote") {
			setActiveTab("configure")
		}
	}, [showRemoteServers, activeTab])

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
				{/* Tabs container */}
				<div
					style={{
						display: "flex",
						gap: "1px",
						padding: "0 20px 0 20px",
						borderBottom: "1px solid var(--vscode-panel-border)",
					}}>
					{showRemoteServers && (
						<TabButton isActive={activeTab === "addRemote"} onClick={() => handleTabChange("addRemote")}>
							Remote Servers
						</TabButton>
					)}
					<TabButton isActive={activeTab === "configure"} onClick={() => handleTabChange("configure")}>
						Configure
					</TabButton>
				</div>

				{/* Content container */}
				<div style={{ width: "100%" }}>
					{showRemoteServers && activeTab === "addRemote" && (
						<AddRemoteServerForm onServerAdded={() => handleTabChange("configure")} />
					)}
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
