import { EmptyRequest } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import ServersToggleList from "@/components/mcp/configuration/tabs/installed/ServersToggleList"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

const ServersToggleModal: React.FC = () => {
	const { mcpServers, navigateToMcp, setMcpServers } = useExtensionState()
	const [isVisible, setIsVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)

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
	}, [isVisible, setMcpServers])

	// Close modal when clicking outside
	useClickAway(modalRef, () => {
		setIsVisible(false)
	})

	// Calculate positions for modal and arrow
	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const buttonRect = buttonRef.current.getBoundingClientRect()
			const buttonCenter = buttonRect.left + buttonRect.width / 2
			const rightPosition = document.documentElement.clientWidth - buttonCenter - 5

			setArrowPosition(rightPosition)
			setMenuPosition(buttonRect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight])

	return (
		<div className="inline-flex min-w-0 max-w-full items-center" ref={modalRef}>
			<div className="inline-flex w-full items-center" ref={buttonRef}>
				<Tooltip>
					{!isVisible && <TooltipContent>Manage MCP Servers</TooltipContent>}
					<TooltipTrigger>
						<VSCodeButton
							appearance="icon"
							aria-label={isVisible ? "Hide MCP Servers" : "Show MCP Servers"}
							className="p-0 m-0 flex items-center"
							onClick={() => setIsVisible(!isVisible)}>
							<i className="codicon codicon-server" style={{ fontSize: "12.5px" }} />
						</VSCodeButton>
					</TooltipTrigger>
				</Tooltip>
			</div>

			{isVisible && (
				<>
					<div
						className="fixed h-2.5 w-2.5 z-[1001] rotate-45 border-r border-b border-editor-group-border"
						style={{
							bottom: `calc(100vh - ${menuPosition}px + 2px)`,
							right: arrowPosition,
							background: CODE_BLOCK_BG_COLOR,
						}}
					/>
					<div
						className="fixed left-[15px] right-[15px] border border-editor-group-border rounded z-[1000] flex flex-col"
						style={{
							bottom: `calc(100vh - ${menuPosition}px + 6px)`,
							background: CODE_BLOCK_BG_COLOR,
							maxHeight: "calc(100vh - 100px)",
							overscrollBehavior: "contain",
						}}>
						<div className="flex-shrink-0 px-3 pt-2">
							<div className="flex justify-between items-center mb-2.5">
								<div className="m-0 text-sm font-medium">MCP Servers</div>
								<VSCodeButton
									appearance="icon"
									aria-label="Go to MCP server settings"
									onClick={() => {
										setIsVisible(false)
										navigateToMcp("configure")
									}}>
									<span className="codicon codicon-gear text-[10px]"></span>
								</VSCodeButton>
							</div>
						</div>

						<div className="flex-1 overflow-y-auto px-3 pb-3" style={{ minHeight: 0 }}>
							<ServersToggleList hasTrashIcon={false} isExpandable={false} listGap="small" servers={mcpServers} />
						</div>
					</div>
				</>
			)}
		</div>
	)
}

export default ServersToggleModal
