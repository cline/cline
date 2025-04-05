import { McpTool } from "@shared/mcp"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useLayoutEffect, useRef } from "react"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
}

const McpToolRow = ({ tool, serverName }: McpToolRowProps) => {
	const { autoApprovalSettings } = useExtensionState()

	// Accept the event object
	const handleAutoApproveChange = (event: any) => {
		// Only proceed if the event was triggered by a direct user interaction
		if (!serverName || !event.isTrusted) return

		vscode.postMessage({
			type: "toggleToolAutoApprove",
			serverName,
			toolNames: [tool.name],
			autoApprove: !tool.autoApprove,
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
				style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
				onClick={(e) => e.stopPropagation()}>
				<div style={{ display: "flex", alignItems: "center" }}>
					<span className="codicon codicon-symbol-method" style={{ marginRight: "6px" }}></span>
					<span style={{ fontWeight: 500 }}>{tool.name}</span>
				</div>
				{serverName && autoApprovalSettings.enabled && autoApprovalSettings.actions.useMcp && (
					<IsolatedCheckbox checked={!!tool.autoApprove} onChange={handleAutoApproveChange} name={tool.name} />
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

// Create an isolated checkbox component that bypasses React's synthetic event system
const IsolatedCheckbox = ({ checked, onChange, name }: { checked: boolean; onChange: (e: any) => void; name: string }) => {
	const ref = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		if (!ref.current) return

		// Create checkbox if it doesn't exist
		if (!ref.current.firstChild) {
			const checkbox = document.createElement("vscode-checkbox")
			checkbox.textContent = "Auto-approve"
			checkbox.setAttribute("data-tool", name)
			checkbox.addEventListener("change", (e) => {
				// Only process trusted events
				if (!(e as any).isTrusted) {
					e.stopPropagation()
					e.preventDefault()
					return
				}
				onChange(e)
			})
			ref.current.appendChild(checkbox)
		}

		// Update checked state
		const checkbox = ref.current.firstChild as HTMLElement
		if (checkbox) {
			if (checked) {
				checkbox.setAttribute("checked", "")
			} else {
				checkbox.removeAttribute("checked")
			}
		}
	}, [checked, onChange, name])

	return <div ref={ref} className="isolated-checkbox-container"></div>
}

export default McpToolRow
