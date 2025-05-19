import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { memo } from "react"
import { OpenAIReasoningEffort } from "@shared/ChatSettings"

const FeatureSettingsSection = () => {
	const {
		enableCheckpointsSetting,
		setEnableCheckpointsSetting,
		mcpMarketplaceEnabled,
		setMcpMarketplaceEnabled,
		chatSettings,
		setChatSettings,
	} = useExtensionState()

	return (
		<div style={{ marginBottom: 20, borderTop: "1px solid var(--vscode-panel-border)", paddingTop: 15 }}>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 10px 0", fontSize: "14px" }}>Feature Settings</h3>
			<div>
				<VSCodeCheckbox
					checked={enableCheckpointsSetting}
					onChange={(e: any) => {
						const checked = e.target.checked === true
						setEnableCheckpointsSetting(checked)
					}}>
					Enable Checkpoints
				</VSCodeCheckbox>
				<p className="text-xs text-[var(--vscode-descriptionForeground)]">
					Enables extension to save checkpoints of workspace throughout the task. Uses git under the hood which may not
					work well with large workspaces.
				</p>
			</div>
			<div style={{ marginTop: 10 }}>
				<VSCodeCheckbox
					checked={mcpMarketplaceEnabled}
					onChange={(e: any) => {
						const checked = e.target.checked === true
						setMcpMarketplaceEnabled(checked)
					}}>
					Enable MCP Marketplace
				</VSCodeCheckbox>
				<p className="text-xs text-[var(--vscode-descriptionForeground)]">
					Enables the MCP Marketplace tab for discovering and installing MCP servers.
				</p>
			</div>
			<div style={{ marginTop: 10 }}>
				<label
					htmlFor="openai-reasoning-effort-dropdown"
					className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
					OpenAI Reasoning Effort
				</label>
				<VSCodeDropdown
					id="openai-reasoning-effort-dropdown"
					currentValue={chatSettings.openAIReasoningEffort || "medium"}
					onChange={(e: any) => {
						const newValue = e.target.currentValue as OpenAIReasoningEffort
						setChatSettings({
							...chatSettings,
							openAIReasoningEffort: newValue,
						})
					}}
					className="w-full">
					<VSCodeOption value="low">Low</VSCodeOption>
					<VSCodeOption value="medium">Medium</VSCodeOption>
					<VSCodeOption value="high">High</VSCodeOption>
				</VSCodeDropdown>
				<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
					Reasoning effort for the OpenAI family of models(applies to all OpenAI model providers)
				</p>
			</div>
		</div>
	)
}

export default memo(FeatureSettingsSection)
