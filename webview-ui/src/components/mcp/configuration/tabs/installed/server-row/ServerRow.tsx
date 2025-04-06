import { McpServer } from "@shared/mcp"
import { DEFAULT_MCP_TIMEOUT_SECONDS } from "@shared/mcp"
import { useState } from "react"
import { vscode } from "@/utils/vscode"
import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react"
import { getMcpServerDisplayName } from "@/utils/mcp"
import DangerButton from "@/components/common/DangerButton"
import McpToolRow from "./McpToolRow"
import McpResourceRow from "./McpResourceRow"
import { useExtensionState } from "@/context/ExtensionStateContext"

const ServerRow = ({ server, isExpandable = true }: { server: McpServer; isExpandable?: boolean }) => {
	const { mcpMarketplaceCatalog, autoApprovalSettings } = useExtensionState()

	const [isExpanded, setIsExpanded] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)

	const getStatusColor = () => {
		switch (server.status) {
			case "connected":
				return "var(--vscode-testing-iconPassed)"
			case "connecting":
				return "var(--vscode-charts-yellow)"
			case "disconnected":
				return "var(--vscode-testing-iconFailed)"
		}
	}

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

	const timeoutOptions = [
		{ value: "30", label: "30 seconds" },
		{ value: "60", label: "1 minute" },
		{ value: "300", label: "5 minutes" },
		{ value: "600", label: "10 minutes" },
		{ value: "1800", label: "30 minutes" },
		{ value: "3600", label: "1 hour" },
	]

	const handleTimeoutChange = (e: any) => {
		const select = e.target as HTMLSelectElement
		const value = select.value
		const num = parseInt(value)
		setTimeoutValue(value)
		vscode.postMessage({
			type: "updateMcpTimeout",
			serverName: server.name,
			timeout: num,
		})
	}

	const handleRestart = () => {
		vscode.postMessage({
			type: "restartMcpServer",
			text: server.name,
		})
	}

	const handleDelete = () => {
		setIsDeleting(true)
		vscode.postMessage({
			type: "deleteMcpServer",
			serverName: server.name,
		})
	}

	const handleAutoApproveChange = () => {
		if (!server.name) return

		vscode.postMessage({
			type: "toggleToolAutoApprove",
			serverName: server.name,
			toolNames: server.tools?.map((tool) => tool.name) || [],
			autoApprove: !server.tools?.every((tool) => tool.autoApprove),
		})
	}

	return (
		<div style={{ marginBottom: "10px" }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "8px",
					background: "var(--vscode-textCodeBlock-background)",

					cursor: server.error ? "default" : isExpandable ? "pointer" : "default",
					borderRadius: isExpanded || server.error ? "4px 4px 0 0" : "4px",
					opacity: server.disabled ? 0.6 : 1,
				}}
				onClick={handleRowClick}>
				{!server.error && isExpandable && (
					<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} style={{ marginRight: "8px" }} />
				)}
				<span
					style={{
						flex: 1,
						overflow: "hidden",
						wordBreak: "break-all",
						whiteSpace: "normal",
						display: "flex",
						alignItems: "center",
						marginRight: "4px",
					}}>
					{getMcpServerDisplayName(server.name, mcpMarketplaceCatalog)}
				</span>
				{/* Collapsed view controls */}
				{!server.error && (
					<div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "8px" }}>
						<VSCodeButton
							appearance="icon"
							title="Restart Server"
							onClick={(e) => {
								e.stopPropagation()
								handleRestart()
							}}
							disabled={server.status === "connecting"}>
							<span className="codicon codicon-sync"></span>
						</VSCodeButton>
						<VSCodeButton
							appearance="icon"
							title="Delete Server"
							onClick={(e) => {
								e.stopPropagation()
								handleDelete()
							}}
							disabled={isDeleting}>
							<span className="codicon codicon-trash"></span>
						</VSCodeButton>
					</div>
				)}
				{/* Toggle Switch */}
				<div style={{ display: "flex", alignItems: "center", marginLeft: "8px" }} onClick={(e) => e.stopPropagation()}>
					<div
						role="switch"
						aria-checked={!server.disabled}
						tabIndex={0}
						style={{
							width: "20px",
							height: "10px",
							backgroundColor: server.disabled
								? "var(--vscode-titleBar-inactiveForeground)"
								: "var(--vscode-testing-iconPassed)",
							borderRadius: "5px",
							position: "relative",
							cursor: "pointer",
							transition: "background-color 0.2s",
							opacity: server.disabled ? 0.5 : 0.9,
						}}
						onClick={() => {
							vscode.postMessage({
								type: "toggleMcpServer",
								serverName: server.name,
								disabled: !server.disabled,
							})
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								vscode.postMessage({
									type: "toggleMcpServer",
									serverName: server.name,
									disabled: !server.disabled,
								})
							}
						}}>
						<div
							style={{
								width: "6px",
								height: "6px",
								backgroundColor: "white",
								border: "1px solid color-mix(in srgb, #666666 65%, transparent)",
								borderRadius: "50%",
								position: "absolute",
								top: "1px",
								left: server.disabled ? "2px" : "12px",
								transition: "left 0.2s",
							}}
						/>
					</div>
				</div>
				<div
					style={{
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						background: getStatusColor(),
						marginLeft: "8px",
					}}
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
					<VSCodeButton
						appearance="secondary"
						onClick={handleRestart}
						disabled={server.status === "connecting"}
						style={{
							width: "calc(100% - 20px)",
							margin: "0 10px 10px 10px",
						}}>
						{server.status === "connecting" ? "Retrying..." : "Retry Connection"}
					</VSCodeButton>

					<DangerButton
						style={{ width: "calc(100% - 20px)", margin: "0 10px 10px 10px" }}
						disabled={isDeleting}
						onClick={handleDelete}>
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
										}}>
										{server.tools.map((tool) => (
											<McpToolRow key={tool.name} tool={tool} serverName={server.name} />
										))}
										{server.name && autoApprovalSettings.enabled && autoApprovalSettings.actions.useMcp && (
											<VSCodeCheckbox
												style={{ marginBottom: -10 }}
												checked={server.tools.every((tool) => tool.autoApprove)}
												onChange={handleAutoApproveChange}
												data-tool="all-tools">
												Auto-approve all tools
											</VSCodeCheckbox>
										)}
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
										}}>
										{[...(server.resourceTemplates || []), ...(server.resources || [])].map((item) => (
											<McpResourceRow
												key={"uriTemplate" in item ? item.uriTemplate : item.uri}
												item={item}
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
							<VSCodeDropdown style={{ width: "100%" }} value={timeoutValue} onChange={handleTimeoutChange}>
								{timeoutOptions.map((option) => (
									<VSCodeOption key={option.value} value={option.value}>
										{option.label}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						</div>
						<VSCodeButton
							appearance="secondary"
							onClick={handleRestart}
							disabled={server.status === "connecting"}
							style={{
								width: "calc(100% - 14px)",
								margin: "0 7px 3px 7px",
							}}>
							{server.status === "connecting" ? "Restarting..." : "Restart Server"}
						</VSCodeButton>

						<DangerButton
							style={{ width: "calc(100% - 14px)", margin: "5px 7px 3px 7px" }}
							disabled={isDeleting}
							onClick={handleDelete}>
							{isDeleting ? "Deleting..." : "Delete Server"}
						</DangerButton>
					</div>
				)
			)}
		</div>
	)
}

export default ServerRow
