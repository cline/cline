import React, { useRef, useState, useEffect } from "react"
import { useClickAway, useWindowSize } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import ServersToggleList from "@/components/mcp/configuration/tabs/installed/ServersToggleList"
import { vscode } from "@/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

const ServersToggleModal: React.FC = () => {
	const { mcpServers } = useExtensionState()
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
			vscode.postMessage({ type: "fetchLatestMcpServersFromHub" })
		}
	}, [isVisible])

	return (
		<div ref={modalRef}>
			<div ref={buttonRef} className="inline-flex min-w-0 max-w-full">
				<VSCodeButton
					appearance="icon"
					aria-label="MCP Servers"
					onClick={() => setIsVisible(!isVisible)}
					style={{ padding: "0px 0px", height: "20px" }}>
					<div className="flex items-center gap-1 text-xs whitespace-nowrap min-w-0 w-full">
						<span
							className="codicon codicon-server flex items-center"
							style={{ fontSize: "12.5px", marginBottom: 1 }}
						/>
					</div>
				</VSCodeButton>
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
						<h3 className="m-0">MCP Servers</h3>
						<VSCodeButton
							appearance="icon"
							onClick={() => {
								vscode.postMessage({
									type: "showMcpView",
									tab: "installed",
								})
								setIsVisible(false)
							}}>
							<span className="codicon codicon-gear text-[10px]"></span>
						</VSCodeButton>
					</div>

					<ServersToggleList servers={mcpServers} isExpandable={false} hasTrashIcon={false} listGap="small" />
				</div>
			)}
		</div>
	)
}

export default ServersToggleModal
