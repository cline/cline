import { EmptyRequest } from "@shared/proto/cline/common"
import { McpServers } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useEffect, useRef, useState } from "react"
import { useClickAway, useWindowSize } from "react-use"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import Tooltip from "@/components/common/Tooltip"
import ServersToggleList from "@/components/mcp/configuration/tabs/installed/ServersToggleList"
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
		<div ref={modalRef}>
			<div className="inline-flex min-w-0 max-w-full" ref={buttonRef}>
				<Tooltip tipText="Manage MCP Servers" visible={isVisible ? false : undefined}>
					<VSCodeButton
						appearance="icon"
						aria-label={isVisible ? "Hide MCP Servers" : "Show MCP Servers"}
						onClick={() => setIsVisible(!isVisible)}
						style={{ padding: "0px 0px", height: "20px" }}>
						<div className="flex items-center gap-1 text-xs whitespace-nowrap min-w-0 w-full">
							<span
								className="codicon codicon-server flex items-center"
								style={{ fontSize: "12.5px", marginBottom: 1 }}
							/>
						</div>
					</VSCodeButton>
				</Tooltip>
			</div>

			{isVisible && (
				<div
					className="fixed left-[15px] right-[15px] border border-[var(--vscode-editorGroup-border)] p-3 rounded z-[1000] overflow-y-auto"
					style={{
						bottom: `calc(100vh - ${menuPosition}px + 6px)`,
						background: CODE_BLOCK_BG_COLOR,
						maxHeight: "calc(100vh - 100px)",
						overscrollBehavior: "contain",
					}}>
					<div
						className="fixed w-[10px] h-[10px] z-[-1] rotate-45 border-r border-b border-[var(--vscode-editorGroup-border)]"
						style={{
							bottom: `calc(100vh - ${menuPosition}px)`,
							right: arrowPosition,
							background: CODE_BLOCK_BG_COLOR,
						}}
					/>

					<div className="flex justify-between items-center mb-2.5">
						<div className="m-0 text-base font-semibold">MCP Servers</div>
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

					<div style={{ marginBottom: -10 }}>
						<ServersToggleList hasTrashIcon={false} isExpandable={false} listGap="small" servers={mcpServers} />
					</div>
				</div>
			)}
		</div>
	)
}

export default ServersToggleModal
