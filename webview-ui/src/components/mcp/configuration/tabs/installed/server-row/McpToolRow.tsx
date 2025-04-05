import { McpTool } from "@shared/mcp"
import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import React, { useLayoutEffect, useRef } from "react"
import { provideVSCodeDesignSystem, vsCodeCheckbox } from "@vscode/webview-ui-toolkit"

// Register the VS Code design system and components
provideVSCodeDesignSystem().register(vsCodeCheckbox())

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
}

const McpToolRow = ({ tool, serverName }: McpToolRowProps) => {
	const { autoApprovalSettings } = useExtensionState()

	// Handle checkbox change event
	const handleAutoApproveChange = (event: Event) => {
		// Only proceed if the event was triggered by a direct user interaction
		if (!serverName || !(event as any).isTrusted) return

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
					<VsCodeCheckbox checked={!!tool.autoApprove} onChange={handleAutoApproveChange} toolName={tool.name} />
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

const VsCodeCheckbox = ({
	checked,
	onChange,
	toolName,
}: {
	checked: boolean
	onChange: (e: Event) => void
	toolName: string
}) => {
	const checkboxRef = useRef<any>(null)

	useLayoutEffect(() => {
		const checkbox = checkboxRef.current
		if (!checkbox) return

		const handleChange = (e: Event) => {
			if (!(e as any).isTrusted) return
			onChange(e)
		}

		checkbox.addEventListener("change", handleChange)
		return () => checkbox.removeEventListener("change", handleChange)
	}, [onChange])

	useLayoutEffect(() => {
		if (!checkboxRef.current) return
		checkboxRef.current.checked = checked
	}, [checked])

	// Use type assertion to bypass TypeScript's JSX element validation
	return React.createElement("vscode-checkbox", {
		ref: checkboxRef,
		"data-tool": toolName,
		children: "Auto-approve",
	})
}

export default McpToolRow
