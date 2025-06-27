import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { McpTool } from "@roo/mcp"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { StandardTooltip } from "@/components/ui"

type McpToolRowProps = {
	tool: McpTool
	serverName?: string
	serverSource?: "global" | "project"
	alwaysAllowMcp?: boolean
	isInChatContext?: boolean
}

const McpToolRow = ({ tool, serverName, serverSource, alwaysAllowMcp, isInChatContext = false }: McpToolRowProps) => {
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

	const handleEnabledForPromptChange = () => {
		if (!serverName) return
		vscode.postMessage({
			type: "toggleToolEnabledForPrompt",
			serverName,
			source: serverSource || "global",
			toolName: tool.name,
			isEnabled: !tool.enabledForPrompt,
		})
	}

	return (
		<div key={tool.name} className="py-2 border-b border-vscode-panel-border last:border-b-0">
			<div
				data-testid="tool-row-container"
				className="flex items-center gap-4"
				onClick={(e) => e.stopPropagation()}>
				{/* Tool name section */}
				<div className="flex items-center min-w-0 flex-1">
					<span className="codicon codicon-symbol-method mr-2 flex-shrink-0 text-vscode-symbolIcon-methodForeground"></span>
					<StandardTooltip content={tool.name}>
						<span className="font-medium truncate text-vscode-foreground">{tool.name}</span>
					</StandardTooltip>
				</div>

				{/* Controls section */}
				{serverName && (
					<div className="flex items-center gap-4 flex-shrink-0">
						{/* Always Allow checkbox */}
						{alwaysAllowMcp && (
							<VSCodeCheckbox
								checked={tool.alwaysAllow}
								onChange={handleAlwaysAllowChange}
								data-tool={tool.name}
								className="text-xs">
								<span className="text-vscode-descriptionForeground whitespace-nowrap">
									{t("mcp:tool.alwaysAllow")}
								</span>
							</VSCodeCheckbox>
						)}

						{/* Enabled eye button - only show in settings context */}
						{!isInChatContext && (
							<StandardTooltip content={t("mcp:tool.togglePromptInclusion")}>
								<button
									role="button"
									aria-pressed={tool.enabledForPrompt}
									aria-label={t("mcp:tool.togglePromptInclusion")}
									className={`p-1 rounded hover:bg-vscode-toolbar-hoverBackground transition-colors ${
										tool.enabledForPrompt
											? "text-vscode-foreground"
											: "text-vscode-descriptionForeground opacity-60"
									}`}
									onClick={handleEnabledForPromptChange}
									data-tool-prompt-toggle={tool.name}>
									<span
										className={`codicon ${
											tool.enabledForPrompt ? "codicon-eye-closed" : "codicon-eye"
										} text-base`}
									/>
								</button>
							</StandardTooltip>
						)}
					</div>
				)}
			</div>
			{tool.description && (
				<div className="mt-1 text-xs text-vscode-descriptionForeground opacity-80">{tool.description}</div>
			)}
			{tool.inputSchema &&
				"properties" in tool.inputSchema &&
				Object.keys(tool.inputSchema.properties as Record<string, any>).length > 0 && (
					<div className="mt-2 text-xs border border-vscode-panel-border rounded p-2">
						<div className="mb-1 text-[11px] uppercase opacity-80 text-vscode-descriptionForeground">
							{t("mcp:tool.parameters")}
						</div>
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
										<span className="opacity-80 break-words text-vscode-descriptionForeground">
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
