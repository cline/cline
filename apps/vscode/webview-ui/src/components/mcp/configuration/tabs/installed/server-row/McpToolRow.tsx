import { McpTool } from "@shared/mcp"
import { ToggleToolAutoApproveRequest } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
}

// Per-tool MCP auto-approve checkboxes are hidden for now: the SDK approval
// path (shared with the CLI and desktop app) is all-or-nothing via the global
// "Use MCP servers" toggle, so they would be no-ops. Flip this back on if the
// SDK ever gains per-tool approval granularity.
export const SHOW_MCP_PER_TOOL_AUTO_APPROVE = false

/**
 * Shows the server's own read-only claim next to the tool name. Only a declared
 * hint is shown: an undeclared tool gets no badge, since absence of a hint is
 * not a statement about the tool.
 */
const ToolHintBadge = ({ tool }: { tool: McpTool }) => {
	const readOnlyHint = tool.annotations?.readOnlyHint
	if (readOnlyHint === undefined) {
		return null
	}
	return (
		<span
			className="text-description border border-description/40 rounded-sm px-1.5 py-px text-[10px] uppercase tracking-wide shrink-0"
			data-testid="tool-hint-badge"
			title={
				readOnlyHint
					? "The server declares this tool read-only (readOnlyHint). A hint from the server, not a guarantee."
					: "The server declares this tool may modify its environment (readOnlyHint: false)."
			}>
			{readOnlyHint ? "read-only" : "modifies"}
		</span>
	)
}

const McpToolRow = ({ tool, serverName }: McpToolRowProps) => {
	const { autoApprovalSettings } = useExtensionState()

	const { setMcpServers } = useExtensionState()

	// Accept the event object
	const handleAutoApproveChange = (_event: any) => {
		if (!serverName) {
			return
		}

		McpServiceClient.toggleToolAutoApprove(
			ToggleToolAutoApproveRequest.create({
				serverName,
				toolNames: [tool.name],
				autoApprove: !tool.autoApprove,
			}),
		)
			.then((response) => {
				const mcpServers = convertProtoMcpServersToMcpServers(response.mcpServers)
				setMcpServers(mcpServers)
			})
			.catch((error) => {
				console.error("Error toggling tool auto-approve", error)
			})
	}
	return (
		<div
			key={tool.name}
			style={{
				padding: "3px 0",
			}}>
			<div
				data-testid="tool-row-container"
				onClick={(e) => e.stopPropagation()}
				style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "4px" }}>
				<div style={{ display: "flex", alignItems: "center", minWidth: 0, flex: "1 1 auto" }}>
					<span className="codicon codicon-symbol-method" style={{ marginRight: "6px", flexShrink: 0 }} />
					<span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", marginRight: "6px" }}>
						{tool.name}
					</span>
					<ToolHintBadge tool={tool} />
				</div>
				{SHOW_MCP_PER_TOOL_AUTO_APPROVE && serverName && autoApprovalSettings.actions.useMcp && (
					<VSCodeCheckbox
						checked={tool.autoApprove ?? false}
						data-tool={tool.name}
						onChange={handleAutoApproveChange}
						style={{ fontSize: "11px" }}>
						Auto-approve
					</VSCodeCheckbox>
				)}
			</div>
			{tool.description && (
				<div
					style={{
						marginLeft: "0px",
						marginTop: "4px",
						opacity: 0.8,
						fontSize: "12px",
					}}>
					{tool.description}
				</div>
			)}
			{tool.inputSchema &&
				"properties" in tool.inputSchema &&
				Object.keys(tool.inputSchema.properties as Record<string, any>).length > 0 && (
					<div
						style={{
							marginTop: "8px",
							fontSize: "12px",
							border: "1px solid color-mix(in srgb, var(--vscode-descriptionForeground) 30%, transparent)",
							borderRadius: "3px",
							padding: "8px",
						}}>
						<div
							style={{
								marginBottom: "4px",
								opacity: 0.8,
								fontSize: "11px",
								textTransform: "uppercase",
							}}>
							Parameters
						</div>
						{Object.entries(tool.inputSchema.properties as Record<string, any>).map(([paramName, schema]) => {
							const isRequired =
								tool.inputSchema &&
								"required" in tool.inputSchema &&
								Array.isArray(tool.inputSchema.required) &&
								tool.inputSchema.required.includes(paramName)

							return (
								<div
									key={paramName}
									style={{
										display: "flex",
										alignItems: "baseline",
										marginTop: "4px",
									}}>
									<code
										style={{
											color: "var(--vscode-textPreformat-foreground)",
											marginRight: "8px",
										}}>
										{paramName}
										{isRequired && (
											<span
												style={{
													color: "var(--vscode-errorForeground)",
												}}>
												*
											</span>
										)}
									</code>
									<span
										style={{
											opacity: 0.8,
											overflowWrap: "break-word",
											wordBreak: "break-word",
										}}>
										{schema.description || "No description"}
									</span>
								</div>
							)
						})}
					</div>
				)}
		</div>
	)
}

export default McpToolRow
