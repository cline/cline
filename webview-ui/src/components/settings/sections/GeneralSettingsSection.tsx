import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { convertChatSettingsToProtoChatSettings } from "@shared/proto-conversions/state/chat-settings-conversion"
import { memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { OpenAIReasoningEffort } from "@shared/ChatSettings"
import { updateSetting } from "../utils/settingsHandlers"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting } = useExtensionState()

	const { enableCheckpointsSetting, mcpMarketplaceEnabled, mcpRichDisplayEnabled, mcpResponsesCollapsed, chatSettings } =
		useExtensionState()

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
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />
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
				</div>
				<div className="mb-[5px]">
					<VSCodeCheckbox
						className="mb-[5px]"
						checked={telemetrySetting !== "disabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
						}}>
						Allow anonymous error and usage reporting
					</VSCodeCheckbox>
					<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
						Help improve Cline by sending anonymous usage data and error reports. No code, prompts, or personal
						information are ever sent. See our{" "}
						<VSCodeLink href="https://docs.cline.bot/more-info/telemetry" className="text-inherit">
							telemetry overview
						</VSCodeLink>{" "}
						and{" "}
						<VSCodeLink href="https://cline.bot/privacy" className="text-inherit">
							privacy policy
						</VSCodeLink>{" "}
						for more details.
					</p>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection
