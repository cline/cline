import { McpPrompt } from "@shared/mcp"

type McpPromptRowProps = {
	prompt: McpPrompt
	serverName?: string
}

const McpPromptRow = ({ prompt, serverName }: McpPromptRowProps) => {
	return (
		<div
			key={prompt.name}
			style={{
				padding: "3px 0",
			}}>
			<div
				data-testid="prompt-row-container"
				onClick={(e) => e.stopPropagation()}
				style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "4px" }}>
				<div style={{ display: "flex", alignItems: "center", minWidth: 0, flex: "1 1 auto" }}>
					<span className="codicon codicon-comment-discussion" style={{ marginRight: "6px", flexShrink: 0 }}></span>
					<span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
						{prompt.title || prompt.name}
					</span>
				</div>
			</div>
			{prompt.description && (
				<div
					style={{
						marginLeft: "0px",
						marginTop: "4px",
						opacity: 0.8,
						fontSize: "12px",
					}}>
					{prompt.description}
				</div>
			)}
			{prompt.arguments && prompt.arguments.length > 0 && (
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
						Arguments
					</div>
					{prompt.arguments.map((arg) => (
						<div
							key={arg.name}
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
								{arg.name}
								{arg.required && (
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
								{arg.description || "No description"}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}

export default McpPromptRow
