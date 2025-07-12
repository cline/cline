import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { memo } from "react"
import { OpenAIReasoningEffort } from "@shared/ChatSettings"
import { updateSetting } from "../utils/settingsHandlers"
import { convertChatSettingsToProtoChatSettings } from "@shared/proto-conversions/state/chat-settings-conversion"
import Section from "../Section"

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		mcpMarketplaceEnabled,
		mcpRichDisplayEnabled,
		mcpResponsesCollapsed,
		chatSettings,
		fastApplySettings,
	} = useExtensionState()

	const handleReasoningEffortChange = (newValue: OpenAIReasoningEffort) => {
		if (!chatSettings) return

		const updatedChatSettings = {
			...chatSettings,
			openAIReasoningEffort: newValue,
		}

		const protoChatSettings = convertChatSettingsToProtoChatSettings(updatedChatSettings)
		updateSetting("chatSettings", protoChatSettings)
	}

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					<div>
						<VSCodeCheckbox
							checked={enableCheckpointsSetting}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("enableCheckpointsSetting", checked)
							}}>
							Enable Checkpoints
						</VSCodeCheckbox>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Enables extension to save checkpoints of workspace throughout the task. Uses git under the hood which
							may not work well with large workspaces.
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={mcpMarketplaceEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("mcpMarketplaceEnabled", checked)
							}}>
							Enable MCP Marketplace
						</VSCodeCheckbox>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Enables the MCP Marketplace tab for discovering and installing MCP servers.
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={mcpRichDisplayEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("mcpRichDisplayEnabled", checked)
							}}>
							Enable Rich MCP Display
						</VSCodeCheckbox>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Enables rich formatting for MCP responses. When disabled, responses will be shown in plain text.
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={mcpResponsesCollapsed}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("mcpResponsesCollapsed", checked)
							}}>
							Collapse MCP Responses
						</VSCodeCheckbox>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Sets the default display mode for MCP response panels
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
								handleReasoningEffortChange(newValue)
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
					<div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--vscode-widget-border)" }}>
						<h3 className="text-sm font-medium text-[var(--vscode-foreground)] mb-3">Fast Apply Settings</h3>
						<div>
							<VSCodeCheckbox
								checked={fastApplySettings?.enabled || false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("fastApplySettings", {
										enabled: checked,
										provider: fastApplySettings?.provider || "morph",
										apiKey: fastApplySettings?.apiKey || "",
									})
								}}>
								Enable Fast Apply
							</VSCodeCheckbox>
							<p className="text-xs text-[var(--vscode-descriptionForeground)]">
								Use Morph's fast apply API to modify files efficiently
							</p>
						</div>
						{fastApplySettings?.enabled && (
							<>
								<div style={{ marginTop: 10 }}>
									<label
										htmlFor="fast-apply-provider-dropdown"
										className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
										Provider
									</label>
									<VSCodeDropdown
										id="fast-apply-provider-dropdown"
										currentValue={fastApplySettings?.provider || "morph"}
										onChange={(e: any) => {
											const newValue = e.target.currentValue
											updateSetting("fastApplySettings", {
												enabled: fastApplySettings?.enabled || false,
												provider: newValue,
												apiKey: fastApplySettings?.apiKey || "",
											})
										}}
										className="w-full">
										<VSCodeOption value="morph">Morph</VSCodeOption>
									</VSCodeDropdown>
								</div>
								<div style={{ marginTop: 10 }}>
									<label
										htmlFor="fast-apply-api-key"
										className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
										API Key
									</label>
									<VSCodeTextField
										id="fast-apply-api-key"
										type="password"
										value={fastApplySettings?.apiKey || ""}
										placeholder="Enter your Morph API key"
										onInput={(e: any) => {
											const newValue = e.target.value
											updateSetting("fastApplySettings", {
												enabled: fastApplySettings?.enabled || false,
												provider: fastApplySettings?.provider || "morph",
												apiKey: newValue,
											})
										}}
										className="w-full"
									/>
									<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
										Your API key for the selected provider
									</p>
								</div>
							</>
						)}
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
