import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { memo } from "react"
import { OpenAIReasoningEffort } from "@shared/ChatSettings"
import { SUPPORTED_DICTATION_LANGUAGES } from "@shared/DictationSettings"
import CollapsibleContent from "../CollapsibleContent"
import Section from "../Section"

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		setEnableCheckpointsSetting,
		mcpMarketplaceEnabled,
		setMcpMarketplaceEnabled,
		mcpRichDisplayEnabled,
		setMcpRichDisplayEnabled,
		mcpResponsesCollapsed,
		setMcpResponsesCollapsed,
		chatSettings,
		setChatSettings,
		dictationSettings,
		setDictationSettings,
	} = useExtensionState()

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
								setEnableCheckpointsSetting(checked)
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
								setMcpMarketplaceEnabled(checked)
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
								setMcpRichDisplayEnabled(checked)
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
								setMcpResponsesCollapsed(checked)
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
							Reasoning effort for the OpenAI family of models (applies to all OpenAI model providers)
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<div>
							<VSCodeCheckbox
								checked={dictationSettings?.voiceRecordingEnabled}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									setDictationSettings({
										...dictationSettings,
										voiceRecordingEnabled: checked,
									})
								}}>
								Enable Dictation
							</VSCodeCheckbox>
							<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
								Enables voice recording with automatic transcription. Requires a Cline Account for the
								transcription model.
							</p>
						</div>

						{/* TODO: Fix and use CollapsibleContent, the animation is good but it breaks the dropdown
						<CollapsibleContent isOpen={dictationSettings?.voiceRecordingEnabled}> */}
						<div className={dictationSettings?.voiceRecordingEnabled ? "mt-4" : "hidden"}>
							<label
								htmlFor="dictation-language-dropdown"
								className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1">
								Dictation Language
							</label>
							<VSCodeDropdown
								id="dictation-language-dropdown"
								currentValue={dictationSettings?.dictationLanguage || "en"}
								onChange={(e: any) => {
									const newValue = e.target.value
									setDictationSettings({
										...dictationSettings,
										dictationLanguage: newValue,
									})
								}}
								className="w-full">
								{SUPPORTED_DICTATION_LANGUAGES.map((language) => (
									<VSCodeOption key={language.code} value={language.code} className="py-0.5">
										{language.name}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
							<p className="text-xs mt-1 text-[var(--vscode-descriptionForeground)]">
								The language you want to speak to the Dictation service in. Separate from preferred UI language.
							</p>
						</div>
						{/* </CollapsibleContent> */}
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
