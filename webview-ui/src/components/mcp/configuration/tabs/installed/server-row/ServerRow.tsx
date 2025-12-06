import { DEFAULT_MCP_TIMEOUT_SECONDS, McpServer } from "@shared/mcp"
import { StringRequest } from "@shared/proto/cline/common"
import {
	McpServers,
	ToggleMcpServerRequest,
	ToggleToolAutoApproveRequest,
	UpdateMcpTimeoutRequest,
} from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react"
import { RefreshCcwIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import DangerButton from "@/components/common/DangerButton"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { McpServiceClient } from "@/services/grpc-client"
import { getMcpServerDisplayName } from "@/utils/mcp"
import McpResourceRow from "./McpResourceRow"
import McpToolRow from "./McpToolRow"

// constant JSX.Elements
const TimeoutOptions = [
	{ value: "30", label: "30 seconds" },
	{ value: "60", label: "1 minute" },
	{ value: "300", label: "5 minutes" },
	{ value: "600", label: "10 minutes" },
	{ value: "1800", label: "30 minutes" },
	{ value: "3600", label: "1 hour" },
].map((option) => (
	<VSCodeOption key={option.value} value={option.value}>
		{option.label}
	</VSCodeOption>
))

const ServerRow = ({
	server,
	isExpandable = true,
	hasTrashIcon = true,
}: {
	server: McpServer
	isExpandable?: boolean
	hasTrashIcon?: boolean
}) => {
	const { mcpMarketplaceCatalog, autoApprovalSettings, setMcpServers } = useExtensionState()

	const [isExpanded, setIsExpanded] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)
	const [isRestarting, setIsRestarting] = useState(false)

	const handleRowClick = () => {
		if (!server.error && isExpandable) {
			setIsExpanded(!isExpanded)
		}
	}

	const [timeoutValue, setTimeoutValue] = useState<string>(() => {
		try {
			const config = JSON.parse(server.config)
			return config.timeout?.toString() || DEFAULT_MCP_TIMEOUT_SECONDS.toString()
		} catch {
			return DEFAULT_MCP_TIMEOUT_SECONDS.toString()
		}
	})

	const handleTimeoutChange = (e: any) => {
		const select = e.target as HTMLSelectElement
		const value = select.value
		const num = parseInt(value)
		setTimeoutValue(value)

		McpServiceClient.updateMcpTimeout({
			serverName: server.name,
			timeout: num,
		} as UpdateMcpTimeoutRequest)
			.then((response: McpServers) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				console.error("Error updating MCP server timeout", error)
			})
	}

	const handleRestart = () => {
		// Set local state to show "connecting" status
		setIsRestarting(true)

		// Make the gRPC call
		McpServiceClient.restartMcpServer({
			value: server.name,
		} as StringRequest)
			.then((response: McpServers) => {
				// Update with the final state from the server
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
				setIsRestarting(false)
			})
			.catch((error) => {
				// Reset the restarting state
				setIsRestarting(false)
				console.error("Error restarting MCP server", error)
			})
	}

	const handleDelete = () => {
		setIsDeleting(true)
		McpServiceClient.deleteMcpServer({
			value: server.name,
		} as StringRequest)
			.then((response: McpServers) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
				setIsDeleting(false)
			})
			.catch((error) => {
				console.error("Error deleting MCP server", error)
				setIsDeleting(false)
			})
	}

	const handleAutoApproveChange = () => {
		if (!server.name) {
			return
		}

		McpServiceClient.toggleToolAutoApprove(
			ToggleToolAutoApproveRequest.create({
				serverName: server.name,
				toolNames: server.tools?.map((tool) => tool.name) || [],
				autoApprove: !server.tools?.every((tool) => tool.autoApprove),
			}),
		)
			.then((response) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				console.error("Error toggling all tools auto-approve", error)
			})
	}

	const handleToggleMcpServer = () => {
		McpServiceClient.toggleMcpServer(
			ToggleMcpServerRequest.create({
				serverName: server.name,
				disabled: !server.disabled,
			}),
		)
			.then((response) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				console.error("Error toggling MCP server", error)
			})
	}

	return (
		<div className="mb-2.5">
			<div className="flex bg-code-block-background p-2 gap-4 items-center" onClick={handleRowClick}>
				{!server.error && isExpandable && (
					<span
						className={cn("mr-2 codicon", {
							"codicon-chevron-right": !isExpanded,
							"codicon-chevron-down": isExpanded,
						})}
					/>
				)}
				<span className="flex-1 overflow-hidden break-all whitespace-normal flex items-center">
					{getMcpServerDisplayName(server.name, mcpMarketplaceCatalog)}
				</span>
				{/* Collapsed view controls */}
				{!server.error && (
					<Button
						disabled={server.status === "connecting" || isRestarting || server.disabled}
						onClick={(e) => {
							e.stopPropagation()
							handleRestart()
						}}
						size="icon"
						title="Restart Server"
						variant="icon">
						<RefreshCcwIcon />
					</Button>
				)}
				{!server.error && hasTrashIcon && (
					<Button
						disabled={isDeleting}
						onClick={(e) => {
							e.stopPropagation()
							handleDelete()
						}}
						size="icon"
						title="Delete Server"
						variant="icon">
						<Trash2Icon />
					</Button>
				)}
				{/* Toggle Switch */}
				<Switch checked={!server.disabled} key={server.name} onClick={handleToggleMcpServer} />
				<div
					className={cn("h-2 w-2 ml-0.5 rounded-full", {
						"bg-success": server.status === "connected",
						"bg-warning": server.status === "connecting",
						"bg-error": server.status === "disconnected",
					})}
				/>
			</div>

			{server.error ? (
				<div
					style={{
						fontSize: "13px",
						background: "var(--vscode-textCodeBlock-background)",
						borderRadius: "0 0 4px 4px",
						width: "100%",
					}}>
					<div
						style={{
							color: "var(--vscode-testing-iconFailed)",
							marginBottom: "8px",
							padding: "0 10px",
							overflowWrap: "break-word",
							wordBreak: "break-word",
						}}>
						{server.error}
					</div>
					{server.oauthRequired && server.oauthAuthStatus === "unauthenticated" ? (
						<VSCodeButton
							appearance="primary"
							onClick={(e) => {
								e.stopPropagation()
								McpServiceClient.authenticateMcpServer(StringRequest.create({ value: server.name }))
							}}
							style={{
								width: "calc(100% - 20px)",
								margin: "0 10px 10px 10px",
							}}>
							Authenticate
						</VSCodeButton>
					) : (
						<VSCodeButton
							appearance="secondary"
							disabled={server.status === "connecting"}
							onClick={handleRestart}
							style={{
								width: "calc(100% - 20px)",
								margin: "0 10px 10px 10px",
							}}>
							{server.status === "connecting" || isRestarting ? "Retrying..." : "Retry Connection"}
						</VSCodeButton>
					)}

					<DangerButton
						disabled={isDeleting}
						onClick={handleDelete}
						style={{ width: "calc(100% - 20px)", margin: "0 10px 10px 10px" }}>
						{isDeleting ? "Deleting..." : "Delete Server"}
					</DangerButton>
				</div>
			) : (
				isExpanded && (
					<div
						style={{
							background: "var(--vscode-textCodeBlock-background)",
							padding: "0 10px 10px 10px",
							fontSize: "13px",
							borderRadius: "0 0 4px 4px",
						}}>
						<VSCodePanels>
							<VSCodePanelTab id="tools">Tools ({server.tools?.length || 0})</VSCodePanelTab>
							<VSCodePanelTab id="resources">
								Resources ({[...(server.resourceTemplates || []), ...(server.resources || [])].length || 0})
							</VSCodePanelTab>

							<VSCodePanelView id="tools-view">
								{server.tools && server.tools.length > 0 ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "8px",
											width: "100%",
											paddingTop: "8px",
										}}>
										{server.name && autoApprovalSettings.actions.useMcp && (
											<VSCodeCheckbox
												checked={server.tools.every((tool) => tool.autoApprove)}
												data-tool="all-tools"
												onChange={handleAutoApproveChange}
												style={{ marginBottom: "4px", fontSize: "11px" }}>
												Auto-approve all tools
											</VSCodeCheckbox>
										)}
										{server.tools.map((tool) => (
											<McpToolRow key={tool.name} serverName={server.name} tool={tool} />
										))}
									</div>
								) : (
									<div
										style={{
											padding: "10px 0",
											color: "var(--vscode-descriptionForeground)",
										}}>
										No tools found
									</div>
								)}
							</VSCodePanelView>

							<VSCodePanelView id="resources-view">
								{(server.resources && server.resources.length > 0) ||
								(server.resourceTemplates && server.resourceTemplates.length > 0) ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "8px",
											width: "100%",
											paddingTop: "8px",
										}}>
										{[...(server.resourceTemplates || []), ...(server.resources || [])].map((item) => (
											<McpResourceRow
												item={item}
												key={"uriTemplate" in item ? item.uriTemplate : item.uri}
											/>
										))}
									</div>
								) : (
									<div
										style={{
											padding: "10px 0",
											color: "var(--vscode-descriptionForeground)",
										}}>
										No resources found
									</div>
								)}
							</VSCodePanelView>
						</VSCodePanels>

						<div style={{ margin: "10px 7px" }}>
							<label style={{ display: "block", marginBottom: "4px", fontSize: "13px" }}>Request Timeout</label>
							<VSCodeDropdown onChange={handleTimeoutChange} style={{ width: "100%" }} value={timeoutValue}>
								{TimeoutOptions}
							</VSCodeDropdown>
						</div>
						<VSCodeButton
							appearance="secondary"
							disabled={server.status === "connecting" || isRestarting}
							onClick={handleRestart}
							style={{
								width: "calc(100% - 14px)",
								margin: "0 7px 3px 7px",
							}}>
							{server.status === "connecting" || isRestarting ? "Restarting..." : "Restart Server"}
						</VSCodeButton>

						<DangerButton
							disabled={isDeleting}
							onClick={handleDelete}
							style={{ width: "calc(100% - 14px)", margin: "5px 7px 3px 7px" }}>
							{isDeleting ? "Deleting..." : "Delete Server"}
						</DangerButton>
					</div>
				)
			)}
		</div>
	)
}

export default ServerRow
