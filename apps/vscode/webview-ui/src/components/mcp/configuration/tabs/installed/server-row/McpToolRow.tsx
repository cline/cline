import { McpTool } from "@shared/mcp"
import { ToggleToolAutoApproveRequest } from "@shared/proto/cline/mcp"
import { convertProtoMcpServersToMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { McpServiceClient } from "@/services/grpc-client"
import PlanModeAccessCheckbox from "./PlanModeAccessCheckbox"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
	/** Offer the Plan-mode override. Set where `tool` carries the server's hints. */
	showPlanModeAccess?: boolean
}

// Per-tool MCP auto-approve checkboxes are hidden for now: the SDK approval
// path (shared with the CLI and desktop app) is all-or-nothing via the global
// "Use MCP servers" toggle, so they would be no-ops. Flip this back on if the
// SDK ever gains per-tool approval granularity.
export const SHOW_MCP_PER_TOOL_AUTO_APPROVE = false

// Only a declared read-only tool gets a badge: that is the set Plan mode can
// run without asking. Labelling the rest either marks undeclared tools as
// read-write, which is wrong for an old server's getters, or needs a noisy
// third "unknown" label. Rows without a badge say nothing either way.
const ToolHintBadge = ({ tool }: { tool: McpTool }) => {
	if (tool.annotations?.readOnlyHint !== true) {
		return null
	}
	return (
		<span
			className="text-description border border-description/40 rounded-sm px-1.5 py-px text-[10px] uppercase tracking-wide shrink-0"
			data-testid="tool-hint-badge"
			title="The server declares this tool read-only (readOnlyHint). A hint from the server, not a guarantee.">
			read-only
		</span>
	)
}

const McpToolRow = ({ tool, serverName, showPlanModeAccess }: McpToolRowProps) => {
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
				{/* A declared read-only tool is already available in Plan mode. */}
				{showPlanModeAccess && serverName && tool.annotations?.readOnlyHint !== true && (
					<PlanModeAccessCheckbox serverName={serverName} toolName={tool.name}>
						Allow in Plan mode
					</PlanModeAccessCheckbox>
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
