import { memo } from "react"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"

interface PendingToolInfoProps {
	pendingToolInfo: {
		tool: string
		path?: string
		command?: string
		content?: string
		diff?: string
		regex?: string
		url?: string
		mcpTool?: string
		mcpServer?: string
		resourceUri?: string
	}
}

/**
 * Displays information about a tool that is pending execution while a hook runs.
 * This component shows a preview of what the tool will do, helping users understand
 * what the hook is evaluating.
 */
const PendingToolInfo = memo(({ pendingToolInfo }: PendingToolInfoProps) => {
	const renderField = (label: string, value: string, isPreview = false) => (
		<div style={{ marginBottom: 6 }}>
			<span style={{ fontWeight: 500 }}>{label}:</span>
			{isPreview ? (
				<div
					style={{
						marginTop: 4,
						padding: 6,
						backgroundColor: CODE_BLOCK_BG_COLOR,
						borderRadius: 3,
						fontFamily: "monospace",
						fontSize: "0.85em",
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
					}}>
					{value}
					{value.length >= 200 && "..."}
				</div>
			) : (
				<span className="ph-no-capture" style={{ marginLeft: 6, fontFamily: "monospace", fontSize: "0.9em" }}>
					{value}
				</span>
			)}
		</div>
	)

	return (
		<div
			style={{
				padding: "12px",
				backgroundColor: "var(--vscode-editor-background)",
				borderBottom: "1px solid var(--vscode-editorGroup-border)",
				opacity: 0.8,
			}}>
			{renderField("Tool", pendingToolInfo.tool)}
			{pendingToolInfo.path && renderField("Path", pendingToolInfo.path)}
			{pendingToolInfo.command && renderField("Command", pendingToolInfo.command)}
			{pendingToolInfo.content && renderField("Content Preview", pendingToolInfo.content, true)}
			{pendingToolInfo.diff && renderField("Diff Preview", pendingToolInfo.diff, true)}
			{pendingToolInfo.regex && renderField("Regex", pendingToolInfo.regex)}
			{pendingToolInfo.url && renderField("URL", pendingToolInfo.url)}
			{pendingToolInfo.mcpServer && renderField("MCP Server", pendingToolInfo.mcpServer)}
			{pendingToolInfo.mcpTool && renderField("MCP Tool", pendingToolInfo.mcpTool)}
			{pendingToolInfo.resourceUri && renderField("Resource URI", pendingToolInfo.resourceUri)}
		</div>
	)
})

export default PendingToolInfo
