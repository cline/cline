import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { McpTool } from "@roo/shared/mcp"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
	serverSource?: "global" | "project"
	alwaysAllowMcp?: boolean
}

const McpToolRow = ({ tool, serverName, serverSource, alwaysAllowMcp }: McpToolRowProps) => {
	const { t } = useAppTranslation()
	const handleAlwaysAllowChange = () => {
		if (!serverName) return
		vscode.postMessage({
			type: "toggleToolAlwaysAllow",
			serverName,
			source: serverSource || "global",
			toolName: tool.name,
			alwaysAllow: !tool.alwaysAllow,
		})
	}

	return (
		<div key={tool.name} className="py-[3px]">
			<div
				data-testid="tool-row-container"
				className="flex items-center justify-between"
				onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center">
					<span className="codicon codicon-symbol-method mr-[6px]"></span>
					<span className="font-medium">{tool.name}</span>
				</div>
				{serverName && alwaysAllowMcp && (
					<VSCodeCheckbox checked={tool.alwaysAllow} onChange={handleAlwaysAllowChange} data-tool={tool.name}>
						{t("mcp:tool.alwaysAllow")}
					</VSCodeCheckbox>
				)}
			</div>
			{tool.description && <div className="ml-0 mt-1 opacity-80 text-xs">{tool.description}</div>}
			{tool.inputSchema &&
				"properties" in tool.inputSchema &&
				Object.keys(tool.inputSchema.properties as Record<string, any>).length > 0 && (
					<div className="mt-2 text-xs rounded-[3px] p-2 border border-vscode-descriptionForeground-transparent-30">
						<div className="mb-1 opacity-80 text-[11px] uppercase">{t("mcp:tool.parameters")}</div>
						{Object.entries(tool.inputSchema.properties as Record<string, any>).map(
							([paramName, schema]) => {
								const isRequired =
									tool.inputSchema &&
									"required" in tool.inputSchema &&
									Array.isArray(tool.inputSchema.required) &&
									tool.inputSchema.required.includes(paramName)

								return (
									<div key={paramName} className="flex items-baseline mt-1">
										<code className="text-vscode-textPreformat-foreground mr-2">
											{paramName}
											{isRequired && <span className="text-vscode-errorForeground">*</span>}
										</code>
										<span className="opacity-80 break-words">
											{schema.description || t("mcp:tool.noDescription")}
										</span>
									</div>
								)
							},
						)}
					</div>
				)}
		</div>
	)
}
export default McpToolRow
