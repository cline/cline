import { EmptyRequest } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useState } from "react"
import ServersToggleList from "@/components/mcp/configuration/tabs/installed/ServersToggleList"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

const ServersToggleModal: React.FC = () => {
	const { mcpServers, navigateToMcp, setMcpServers } = useExtensionState()
	const [isVisible, setIsVisible] = useState(false)

	useEffect(() => {
		if (isVisible) {
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
	}, [isVisible])

	return (
		<Popover onOpenChange={(isModalOpened) => setIsVisible(isModalOpened)}>
			<PopoverTrigger>
				<Tooltip>
					<TooltipContent hidden={isVisible} side="top">
						Manage MCP Servers
					</TooltipContent>
					<TooltipTrigger asChild>
						<VSCodeButton
							appearance="icon"
							aria-label={isVisible ? "Hide MCP Servers" : "Show MCP Servers"}
							style={{ padding: "0px 0px", height: "20px" }}>
							<div className="flex items-center gap-1 text-xs whitespace-nowrap min-w-0 w-full">
								<span
									className="codicon codicon-server flex items-center"
									style={{ fontSize: "12.5px", marginBottom: 1 }}
								/>
							</div>
						</VSCodeButton>
					</TooltipTrigger>
				</Tooltip>
			</PopoverTrigger>

			<PopoverContent className="mx-3 h-full wrap-break-word text-foreground w-[94vw]" side="top">
				<div className="flex justify-between items-center mb-2.5">
					<div className="m-0 text-base font-semibold text-foreground">MCP Servers</div>
					<VSCodeButton
						appearance="icon"
						aria-label="Go to MCP server settings"
						onClick={() => navigateToMcp("installed")}>
						<span className="codicon codicon-gear text-[10px]"></span>
					</VSCodeButton>
				</div>

				<div style={{ marginBottom: -10 }}>
					<ServersToggleList hasTrashIcon={false} isExpandable={false} listGap="small" servers={mcpServers} />
				</div>
			</PopoverContent>
		</Popover>
	)
}

export default ServersToggleModal
