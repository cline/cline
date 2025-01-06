import { McpTool } from "../../../../src/shared/mcp"

type McpToolRowProps = {
	tool: McpTool
}

const McpToolRow = ({ tool }: McpToolRowProps) => {
	return (
		<div
			key={tool.name}
			style={{
				padding: "3px 0",
			}}>
			<div style={{ display: "flex" }}>
				<span className="codicon codicon-symbol-method" style={{ marginRight: "6px" }}></span>
				<span style={{ fontWeight: 500 }}>{tool.name}</span>
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
