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
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { McpServiceClient } from "@/services/grpc-client"
import type { MarketplaceMcpMetadata } from "../ServersToggleList"
import McpPromptRow from "./McpPromptRow"
import McpResourceRow from "./McpResourceRow"
import McpToolRow, { SHOW_MCP_PER_TOOL_AUTO_APPROVE } from "./McpToolRow"

// Timeout choices; labels are i18n keys translated at the render site.
const TimeoutOptions = [
	{ value: "30", labelKey: "mcp:serverRow.timeouts.thirtySeconds" },
	{ value: "60", labelKey: "mcp:serverRow.timeouts.oneMinute" },
	{ value: "300", labelKey: "mcp:serverRow.timeouts.fiveMinutes" },
	{ value: "600", labelKey: "mcp:serverRow.timeouts.tenMinutes" },
	{ value: "1800", labelKey: "mcp:serverRow.timeouts.thirtyMinutes" },
	{ value: "3600", labelKey: "mcp:serverRow.timeouts.oneHour" },
] as const

const ServerRow = ({
	server,
	isExpandable = true,
	hasTrashIcon = true,
	marketplaceMetadata,
}: {
	server: McpServer
	isExpandable?: boolean
	hasTrashIcon?: boolean
	marketplaceMetadata?: MarketplaceMcpMetadata
}) => {
	const { autoApprovalSettings, setMcpServers, remoteConfigSettings } = useExtensionState()
	const { t } = useTranslation()

	const [isExpanded, setIsExpanded] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)
	const [isRestarting, setIsRestarting] = useState(false)

	// Check if user is managed by remote config and if this server is remote-managed.
	// Remote MCP servers from enterprise config are always URL-based (SSE/HTTP).
	// stdio-based local servers are never in remoteMCPServers, so URL matching is sufficient.
	const isRemoteManagedServer = (() => {
		const remoteMCPServers = remoteConfigSettings?.remoteMCPServers
		if (!remoteMCPServers || remoteMCPServers.length === 0) {
			return false
		}
		try {
			const serverConfig = JSON.parse(server.config)
			return remoteMCPServers.some(
				(remoteServer: { url: string }) => serverConfig.url && serverConfig.url === remoteServer.url,
			)
		} catch {
			return false
		}
	})()

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
		const num = Number.parseInt(value)
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

	// Helper to extract server URL from config
	const getServerUrl = (server: McpServer): string | null => {
		try {
			const config = JSON.parse(server.config)
			return config.url || null
		} catch {
			return null
		}
	}

	// Check if this server is always-enabled via remote config
	const isAlwaysEnabled = (() => {
		const remoteMCPServers = remoteConfigSettings?.remoteMCPServers || []
		const serverUrl = getServerUrl(server)
		if (!serverUrl) return false

		const remoteServer = remoteMCPServers.find((remote) => remote.url === serverUrl)
		return remoteServer?.alwaysEnabled === true
	})()

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
				<span className="flex-1 min-w-0 overflow-hidden break-words whitespace-normal">
					<span className="block font-medium">{marketplaceMetadata?.name || server.name}</span>
					{marketplaceMetadata?.description && (
						<span className="block mt-0.5 text-xs text-description">{marketplaceMetadata.description}</span>
					)}
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
						title={t("mcp:serverRow.restartServer")}
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
						title={t("mcp:serverRow.deleteServer")}
						variant="icon">
						<Trash2Icon />
					</Button>
				)}
				{/* Toggle Switch */}
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex items-center gap-2">
							<Switch
								checked={!server.disabled}
								disabled={isAlwaysEnabled}
								key={server.name}
								onClick={(e) => {
									e.stopPropagation()
									handleToggleMcpServer()
								}}
							/>
							{isAlwaysEnabled && <i className="codicon codicon-lock text-description text-sm" />}
						</div>
					</TooltipTrigger>
					<TooltipContent className="max-w-xs" hidden={!isAlwaysEnabled} side="top">
						{t("mcp:serverRow.alwaysEnabledTooltip")}
					</TooltipContent>
				</Tooltip>
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
							{t("mcp:serverRow.authenticate")}
						</Button>
					) : (
						<Button
							className="m-2.5 mt-0 max-w-[calc(100%-20px)]"
							disabled={server.status === "connecting"}
							onClick={handleRestart}
							variant="secondary">
							{server.status === "connecting" || isRestarting
								? t("mcp:serverRow.retrying")
								: t("mcp:serverRow.retryConnection")}
						</Button>
					)}

					{!isRemoteManagedServer && (
						<Button
							className="m-2.5 mt-0 max-w-[calc(100%-20px)]"
							disabled={isDeleting}
							onClick={handleDelete}
							variant="danger">
							{isDeleting ? t("mcp:serverRow.deleting") : t("mcp:serverRow.deleteServer")}
						</Button>
					)}
				</div>
			) : (
				isExpanded && (
					<div className="bg-text-block-background p-2.5 pt-0 text-sm rounded-b-sm">
						<VSCodePanels>
							<VSCodePanelTab id="tools">
								{t("mcp:serverRow.toolsTab", { count: server.tools?.length || 0 })}
							</VSCodePanelTab>
							<VSCodePanelTab id="resources">
								{t("mcp:serverRow.resourcesTab", {
									count: [...(server.resourceTemplates || []), ...(server.resources || [])].length || 0,
								})}
							</VSCodePanelTab>
							<VSCodePanelTab id="prompts">
								{t("mcp:serverRow.promptsTab", { count: server.prompts?.length || 0 })}
							</VSCodePanelTab>

							<VSCodePanelView id="tools-view">
								{server.tools && server.tools.length > 0 ? (
									<div className="flex flex-col gap-2 w-full pt-2">
										{SHOW_MCP_PER_TOOL_AUTO_APPROVE && server.name && autoApprovalSettings.actions.useMcp && (
											<VSCodeCheckbox
												checked={server.tools.every((tool) => tool.autoApprove)}
												className="mb-1 text-xs"
												data-tool="all-tools"
												onChange={handleAutoApproveChange}>
												{t("mcp:serverRow.autoApproveAll")}
											</VSCodeCheckbox>
										)}
										{server.tools.map((tool) => (
											<McpToolRow key={tool.name} serverName={server.name} tool={tool} />
										))}
									</div>
								) : (
									<div className="text-description py-2.5">{t("mcp:serverRow.noTools")}</div>
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
									<div className="py-2.5 text-description">{t("mcp:serverRow.noResources")}</div>
								)}
							</VSCodePanelView>

							<VSCodePanelView id="prompts-view">
								{server.prompts && server.prompts.length > 0 ? (
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "8px",
											width: "100%",
											paddingTop: "8px",
										}}>
										{server.prompts.map((prompt) => (
											<McpPromptRow key={prompt.name} prompt={prompt} serverName={server.name} />
										))}
									</div>
								) : (
									<div
										style={{
											padding: "10px 0",
											color: "var(--vscode-descriptionForeground)",
										}}>
										{t("mcp:serverRow.noPrompts")}
									</div>
								)}
							</VSCodePanelView>
						</VSCodePanels>

						<div className="my-2.5 mx-1.5">
							<label className="block mb-1 text-[13px]">{t("mcp:serverRow.requestTimeout")}</label>
							<VSCodeDropdown className="w-full" onChange={handleTimeoutChange} value={timeoutValue}>
								{TimeoutOptions.map((option) => (
									<VSCodeOption key={option.value} value={option.value}>
										{t(option.labelKey)}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
							<p className="mt-1 mb-0 text-xs text-description">{t("mcp:serverRow.timeoutDescription")}</p>
						</div>
						<Button
							className="w-[calc(100%-14px)] mt-1 mx-1.5 mb-3"
							disabled={server.status === "connecting" || isRestarting || server.disabled}
							onClick={handleRestart}
							variant="secondary">
							{server.status === "connecting" || isRestarting
								? t("mcp:serverRow.restarting")
								: server.disabled
									? t("mcp:serverRow.serverDisabled")
									: t("mcp:serverRow.restartServer")}
						</Button>

						{!isRemoteManagedServer && (
							<Button
								className="w-[calc(100%-14px)] mt-1 mx-1.5 mb-3"
								disabled={isDeleting}
								onClick={handleDelete}
								variant="danger">
								{isDeleting ? t("mcp:serverRow.deleting") : t("mcp:serverRow.deleteServer")}
							</Button>
						)}
					</div>
				)
			)}
		</div>
	)
}

export default ServerRow
