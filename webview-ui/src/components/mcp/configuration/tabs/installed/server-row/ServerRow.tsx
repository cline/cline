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
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react"
import { RefreshCcwIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
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
			<div
				className={cn("flex bg-code-block-background p-2 gap-4 items-center", {
					"cursor-pointer": !server.error && isExpandable,
				})}
				onClick={handleRowClick}>
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
				<Switch
					checked={!server.disabled}
					key={server.name}
					onClick={(e) => {
						e.stopPropagation()
						handleToggleMcpServer()
					}}
				/>
				<div
					className={cn("h-2 w-2 ml-0.5 rounded-full", {
						"bg-success": server.status === "connected",
						"bg-warning": server.status === "connecting",
						"bg-error": server.status === "disconnected",
					})}
				/>
			</div>

			{server.error ? (
				<div className="text-sm bg-text-block-background rounded-b-sm">
					<div className="text-failed-icon mb-2 px-2.5 break-words">{server.error}</div>
					{server.oauthRequired && server.oauthAuthStatus === "unauthenticated" ? (
						<Button
							className="m-2.5 mt-0 max-w-[calc(100%-20px)]"
							onClick={(e) => {
								e.stopPropagation()
								McpServiceClient.authenticateMcpServer(StringRequest.create({ value: server.name }))
							}}
							variant="default">
							Authenticate
						</Button>
					) : (
						<Button
							className="m-2.5 mt-0 max-w-[calc(100%-20px)]"
							disabled={server.status === "connecting"}
							onClick={handleRestart}
							variant="secondary">
							{server.status === "connecting" || isRestarting ? "Retrying..." : "Retry Connection"}
						</Button>
					)}

					<Button
						className="m-2.5 mt-0 max-w-[calc(100%-20px)]"
						disabled={isDeleting}
						onClick={handleDelete}
						variant="danger">
						{isDeleting ? "Deleting..." : "Delete Server"}
					</Button>
				</div>
			) : (
				isExpanded && (
					<div className="bg-text-block-background p-2.5 pt-0 text-sm rounded-b-sm">
						<VSCodePanels>
							<VSCodePanelTab id="tools">Tools ({server.tools?.length || 0})</VSCodePanelTab>
							<VSCodePanelTab id="resources">
								Resources ({[...(server.resourceTemplates || []), ...(server.resources || [])].length || 0})
							</VSCodePanelTab>

							<VSCodePanelView id="tools-view">
								{server.tools && server.tools.length > 0 ? (
									<div className="flex flex-col gap-2 w-full pt-2">
										{server.name && autoApprovalSettings.actions.useMcp && (
											<VSCodeCheckbox
												checked={server.tools.every((tool) => tool.autoApprove)}
												className="mb-1 text-xs"
												data-tool="all-tools"
												onChange={handleAutoApproveChange}>
												Auto-approve all tools
											</VSCodeCheckbox>
										)}
										{server.tools.map((tool) => (
											<McpToolRow key={tool.name} serverName={server.name} tool={tool} />
										))}
									</div>
								) : (
									<div className="text-description py-2.5">No tools found</div>
								)}
							</VSCodePanelView>

							<VSCodePanelView id="resources-view">
								{(server.resources && server.resources.length > 0) ||
								(server.resourceTemplates && server.resourceTemplates.length > 0) ? (
									<div className="flex flex-col gap-2 w-full pt-2">
										{[...(server.resourceTemplates || []), ...(server.resources || [])].map((item) => (
											<McpResourceRow
												item={item}
												key={"uriTemplate" in item ? item.uriTemplate : item.uri}
											/>
										))}
									</div>
								) : (
									<div className="py-2.5 text-description">No resources found</div>
								)}
							</VSCodePanelView>
						</VSCodePanels>

						<div className="my-2.5 mx-1.5">
							<label className="block mb-1 text-[13px]">Request Timeout</label>
							<VSCodeDropdown className="w-full" onChange={handleTimeoutChange} value={timeoutValue}>
								{TimeoutOptions}
							</VSCodeDropdown>
						</div>
						<Button
							className="w-[calc(100%-14px)] mt-1 mx-1.5 mb-3"
							disabled={server.status === "connecting" || isRestarting}
							onClick={handleRestart}
							variant="secondary">
							{server.status === "connecting" || isRestarting ? "Restarting..." : "Restart Server"}
						</Button>

						<Button
							className="w-[calc(100%-14px)] mt-1 mx-1.5 mb-3"
							disabled={isDeleting}
							onClick={handleDelete}
							variant="danger">
							{isDeleting ? "Deleting..." : "Delete Server"}
						</Button>
					</div>
				)
			)}
		</div>
	)
}

export default ServerRow
