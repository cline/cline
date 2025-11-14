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
					<span className="codicon codicon-symbol-method" style={{ marginRight: "6px", flexShrink: 0 }}></span>
					<span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{tool.name}</span>
				</div>
				{serverName && autoApprovalSettings.actions.useMcp && (
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
