import { SUPPORTED_DICTATION_LANGUAGES } from "@shared/DictationSettings"
import { McpDisplayMode } from "@shared/McpDisplayMode"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		mcpMarketplaceEnabled,
		mcpDisplayMode,
		mcpResponsesCollapsed,
		openaiReasoningEffort,
		strictPlanModeEnabled,
		yoloModeToggled,
		dictationSettings,
		useAutoCondense,
		focusChainSettings,
		multiRootSetting,
	} = useExtensionState()

	const handleReasoningEffortChange = (newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue)
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
						<label
							className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1"
							htmlFor="mcp-display-mode-dropdown">
							MCP Display Mode
						</label>
						<McpDisplayModeDropdown
							className="w-full"
							id="mcp-display-mode-dropdown"
							onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
							value={mcpDisplayMode}
						/>
						<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
							Controls how MCP responses are displayed: plain text, rich formatting with links/images, or markdown
							rendering.
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
							className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1"
							htmlFor="openai-reasoning-effort-dropdown">
							OpenAI Reasoning Effort
						</label>
						<VSCodeDropdown
							className="w-full"
							currentValue={openaiReasoningEffort || "medium"}
							id="openai-reasoning-effort-dropdown"
							onChange={(e: any) => {
								const newValue = e.target.currentValue as OpenaiReasoningEffort
								handleReasoningEffortChange(newValue)
							}}>
							<VSCodeOption value="minimal">Minimal</VSCodeOption>
							<VSCodeOption value="low">Low</VSCodeOption>
							<VSCodeOption value="medium">Medium</VSCodeOption>
							<VSCodeOption value="high">High</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
							Reasoning effort for the OpenAI family of models(applies to all OpenAI model providers)
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={strictPlanModeEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("strictPlanModeEnabled", checked)
							}}>
							Enable strict plan mode
						</VSCodeCheckbox>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Enforces strict tool use while in plan mode, preventing file edits.
						</p>
					</div>
					{
						<div style={{ marginTop: 10 }}>
							<VSCodeCheckbox
								checked={focusChainSettings?.enabled || false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
								}}>
								Enable Focus Chain
							</VSCodeCheckbox>
							<p className="text-xs text-[var(--vscode-descriptionForeground)]">
								Enables enhanced task progress tracking and automatic focus chain list management throughout
								tasks.
							</p>
						</div>
					}
					{focusChainSettings?.enabled && (
						<div style={{ marginTop: 10, marginLeft: 20 }}>
							<label
								className="block text-sm font-medium text-[var(--vscode-foreground)] mb-1"
								htmlFor="focus-chain-remind-interval">
								Focus Chain Reminder Interval
							</label>
							<VSCodeTextField
								className="w-20"
								id="focus-chain-remind-interval"
								onChange={(e: any) => {
									const value = parseInt(e.target.value, 10)
									if (!Number.isNaN(value) && value >= 1 && value <= 100) {
										updateSetting("focusChainSettings", {
											...focusChainSettings,
											remindClineInterval: value,
										})
									}
								}}
								value={String(focusChainSettings?.remindClineInterval || 6)}
							/>
							<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
								Interval (in messages) to remind Cline about its focus chain checklist (1-100). Lower values
								provide more frequent reminders.
							</p>
						</div>
					)}
					{dictationSettings?.featureEnabled && (
						<>
							<div className="mt-2.5">
								<VSCodeCheckbox
									checked={dictationSettings?.dictationEnabled}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										const updatedDictationSettings = {
											...dictationSettings,
											dictationEnabled: checked,
										}
										updateSetting("dictationSettings", updatedDictationSettings)
									}}>
									Enable Dictation
								</VSCodeCheckbox>
								<p className="text-xs text-description mt-1">
									Enables speech-to-text transcription using your Cline account. Uses the Whisper model, at
									$0.006 credits per minute of audio processed. 5 minutes max per message.
								</p>
							</div>

							{/* TODO: Fix and use CollapsibleContent, the animation is good but it breaks the dropdown
							<CollapsibleContent isOpen={dictationSettings?.dictationEnabled}> */}
							{dictationSettings?.dictationEnabled && (
								<div className="mt-2.5 ml-5">
									<label
										className="block text-sm font-medium text-foreground mb-1"
										htmlFor="dictation-language-dropdown">
										Dictation Language
									</label>
									<VSCodeDropdown
										className="w-full"
										currentValue={dictationSettings?.dictationLanguage || "en"}
										id="dictation-language-dropdown"
										onChange={(e: any) => {
											const newValue = e.target.value
											const updatedDictationSettings = {
												...dictationSettings,
												dictationLanguage: newValue,
											}
											updateSetting("dictationSettings", updatedDictationSettings)
										}}>
										{SUPPORTED_DICTATION_LANGUAGES.map((language) => (
											<VSCodeOption className="py-0.5" key={language.code} value={language.code}>
												{language.name}
											</VSCodeOption>
										))}
									</VSCodeDropdown>
									<p className="text-xs mt-1 text-description">
										The language you want to speak to the Dictation service in. This is separate from your
										preferred UI language.
									</p>
								</div>
							)}
						</>
					)}
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={useAutoCondense}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("useAutoCondense", checked)
							}}>
							Enable Auto Compact
						</VSCodeCheckbox>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Enables advanced context management system which uses LLM based condensing for next-gen models.{" "}
							<a
								className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
								href="https://docs.cline.bot/features/auto-compact"
								rel="noopener noreferrer"
								target="_blank">
								Learn more
							</a>
						</p>
					</div>
					{multiRootSetting.featureFlag && (
						<div className="mt-2.5">
							<VSCodeCheckbox
								checked={multiRootSetting.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("multiRootEnabled", checked)
								}}>
								Enable Multi-Root Workspace
							</VSCodeCheckbox>
							<p className="text-xs">
								<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>{" "}
								<span className="text-description">Allows cline to work across multiple workspaces.</span>
							</p>
						</div>
					)}
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={yoloModeToggled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("yoloModeToggled", checked)
							}}>
							Enable YOLO Mode
						</VSCodeCheckbox>
						<p className="text-xs text-[var(--vscode-errorForeground)]">
							EXPERIMENTAL & DANGEROUS: This mode disables safety checks and user confirmations. Cline will
							automatically approve all actions without asking. Use with extreme caution.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
