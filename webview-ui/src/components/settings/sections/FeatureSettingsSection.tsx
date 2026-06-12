import { SUPPORTED_DICTATION_LANGUAGES } from "@shared/DictationSettings"
import { McpDisplayMode } from "@shared/McpDisplayMode"
import { EmptyRequest } from "@shared/proto/index.cline"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import HeroTooltip from "@/components/common/HeroTooltip"
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import SubagentOutputLineLimitSlider from "../SubagentOutputLineLimitSlider"
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
		maxConsecutiveMistakes,
		multiRootSetting,
		hooksEnabled,
		remoteConfigSettings,
		subagentsEnabled,
		platform,
	} = useExtensionState()

	const isMacOS = platform === "darwin"

	const [isAiHydroCliInstalled, setIsAiHydroCliInstalled] = useState(false)

	const handleReasoningEffortChange = (newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue)
	}

	// Poll for CLI installation status while the component is mounted
	useEffect(() => {
		const checkInstallation = async () => {
			try {
				const result = await StateServiceClient.checkCliInstallation(EmptyRequest.create())
				setIsAiHydroCliInstalled(result.value)
			} catch (error) {
				console.error("Failed to check CLI installation:", error)
			}
		}

		checkInstallation()

		// Poll ever 1.5 seconds to see if CLI is installed (only when form is open)
		const pollInterval = setInterval(checkInstallation, 1500)

		return () => {
			clearInterval(pollInterval)
		}
	}, [])

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				<div className="mb-5">
					{/* Subagents - Only show on macOS (for now) */}
					{isMacOS && (
						<div className="settings-card relative" id="subagents-section">
							<div className="new-badge absolute -top-2 -right-2">NEW</div>{" "}
							<div className="mt-1.5 mb-2 px-2 pt-0.5 pb-1.5 rounded bg-[var(--vscode-inputValidation-warningBackground)] bg-opacity-20">
								<p className="text-xs mb-2 flex items-start text-[var(--vscode-inputValidation-warningForeground)]">
									<span
										className="codicon codicon-warning mr-1"
										style={{ fontSize: "12px", marginTop: "1px", flexShrink: 0 }}></span>
									<span>
										AI-Hydro CLI is required for subagents. Install it with:{" "}
										<code className="ml-1 px-1 rounded bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] opacity-90">
											npm install -g aihydro
										</code>
										, then run
										<code className="ml-1 px-1 rounded bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)] opacity-90">
											aihydro auth
										</code>
										To authenticate with AI-Hydro or configure an API provider.
									</span>
								</p>
								{!isAiHydroCliInstalled && (
									<VSCodeButton
										appearance="secondary"
										onClick={async () => {
											try {
												await StateServiceClient.installAiHydroCli(EmptyRequest.create())
											} catch (error) {
												console.error("Failed to initiate CLI installation:", error)
											}
										}}
										style={{
											transform: "scale(0.85)",
											transformOrigin: "left center",
											marginLeft: "-2px",
										}}>
										Install Now
									</VSCodeButton>
								)}
							</div>
							<VSCodeCheckbox
								checked={subagentsEnabled}
								disabled={!isAiHydroCliInstalled}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("subagentsEnabled", checked)
								}}>
								<span className="font-semibold">
									{subagentsEnabled ? "Subagents Enabled" : "Enable Subagents"}
								</span>
							</VSCodeCheckbox>
							<p className="text-xs mt-1 mb-0">
								<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>{" "}
								<span className="text-description">
									Allows AI-Hydro to spawn subprocesses to handle focused tasks like exploring large codebases,
									keeping your main context clean.
								</span>
							</p>
							{subagentsEnabled && (
								<div className="mt-3">
									<SubagentOutputLineLimitSlider />
								</div>
							)}
						</div>
					)}

					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-checklist" />
							Core Features
						</div>
						<div className="settings-toggle-row">
							<VSCodeCheckbox
								checked={enableCheckpointsSetting}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("enableCheckpointsSetting", checked)
								}}>
								Enable Checkpoints
							</VSCodeCheckbox>
						</div>
						<p className="toggle-description">
							Enables extension to save checkpoints of workspace throughout the task. Uses git under the hood which
							may not work well with large workspaces.
						</p>
					</div>
					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-extensions" />
							MCP & Marketplace
						</div>
						{remoteConfigSettings?.mcpMarketplaceEnabled !== undefined ? (
							<HeroTooltip content="This setting is managed by your organization's remote configuration">
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={mcpMarketplaceEnabled}
										disabled={true}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("mcpMarketplaceEnabled", checked)
										}}>
										Enable MCP Marketplace
									</VSCodeCheckbox>
									<i className="codicon codicon-lock text-[var(--vscode-descriptionForeground)] text-sm" />
								</div>
							</HeroTooltip>
						) : (
							<VSCodeCheckbox
								checked={mcpMarketplaceEnabled}
								disabled={false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("mcpMarketplaceEnabled", checked)
								}}>
								Enable MCP Marketplace
							</VSCodeCheckbox>
						)}
						<p className="toggle-description">
							Enables the MCP Marketplace tab for discovering and installing MCP servers.
						</p>
						<div className="mt-2">
							<label className="settings-label" htmlFor="mcp-display-mode-dropdown">
								MCP Display Mode
							</label>
							<McpDisplayModeDropdown
								className="w-full"
								id="mcp-display-mode-dropdown"
								onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
								value={mcpDisplayMode}
							/>
							<p className="toggle-description">
								Controls how MCP responses are displayed: plain text, rich formatting with links/images, or
								markdown rendering.
							</p>
						</div>
						<div className="mt-2">
							<VSCodeCheckbox
								checked={mcpResponsesCollapsed}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("mcpResponsesCollapsed", checked)
								}}>
								Collapse MCP Responses
							</VSCodeCheckbox>
							<p className="toggle-description">Sets the default display mode for MCP response panels</p>
						</div>
					</div>

					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-brain" />
							AI Reasoning & Planning
						</div>
						<div className="mb-2">
							<label className="settings-label" htmlFor="openai-reasoning-effort-dropdown">
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
							<p className="toggle-description">
								Reasoning effort for the OpenAI family of models (applies to all OpenAI model providers)
							</p>
						</div>
						<div className="mt-2">
							<VSCodeCheckbox
								checked={strictPlanModeEnabled}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("strictPlanModeEnabled", checked)
								}}>
								Enable strict plan mode
							</VSCodeCheckbox>
							<p className="toggle-description">
								Enforces strict tool use while in plan mode, preventing file edits.
							</p>
						</div>
						<div className="mt-2">
							<label className="settings-label" htmlFor="max-consecutive-mistakes">
								Max consecutive mistakes
							</label>
							<VSCodeTextField
								className="w-20"
								id="max-consecutive-mistakes"
								onChange={(e: any) => {
									const value = parseInt(e.target.value, 10)
									if (!Number.isNaN(value) && value >= 1 && value <= 20) {
										updateSetting("maxConsecutiveMistakes", value)
									}
								}}
								value={String(maxConsecutiveMistakes ?? 3)}
							/>
							<p className="toggle-description">
								Number of consecutive tool-call failures before the agent asks for help or auto-recovers (1–20).
								Increase for weaker models; decrease for stricter oversight.
							</p>
						</div>
						{
							<div className="mt-2">
								<VSCodeCheckbox
									checked={focusChainSettings?.enabled || false}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
									}}>
									Enable Focus Chain
								</VSCodeCheckbox>
								<p className="toggle-description">
									Enables enhanced task progress tracking and automatic focus chain list management throughout
									tasks.
								</p>
							</div>
						}
						{focusChainSettings?.enabled && (
							<div className="mt-2 ml-5">
								<label className="settings-label" htmlFor="focus-chain-remind-interval">
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
												remindAiHydroInterval: value,
											})
										}
									}}
									value={String(focusChainSettings?.remindAiHydroInterval || 6)}
								/>
								<p className="toggle-description">
									Interval (in messages) to remind AI-Hydro about its focus chain checklist (1-100). Lower
									values provide more frequent reminders.
								</p>
							</div>
						)}
					</div>

					{dictationSettings?.featureEnabled && (
						<div className="settings-card">
							<div className="settings-section-header">
								<span className="codicon codicon-mic" />
								Dictation
							</div>
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
								<p className="toggle-description">
									Enables speech-to-text transcription using your AI-Hydro account. Uses the Whisper model, at
									$0.006 credits per minute of audio processed. 5 minutes max per message.
								</p>
							</div>

							{dictationSettings?.dictationEnabled && (
								<div className="mt-2.5 ml-5">
									<label className="settings-label" htmlFor="dictation-language-dropdown">
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
									<p className="toggle-description">
										The language you want to speak to the Dictation service in. This is separate from your
										preferred UI language.
									</p>
								</div>
							)}
						</div>
					)}

					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-compress" />
							Context Management
						</div>
						<div className="settings-toggle-row">
							<VSCodeCheckbox
								checked={useAutoCondense}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("useAutoCondense", checked)
								}}>
								Enable Auto Compact
							</VSCodeCheckbox>
						</div>
						<p className="toggle-description">
							Enables advanced context management system which uses LLM based condensing for next-gen models.{" "}
							<a
								className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)]"
								href="https://github.com/AI-Hydro/AI-Hydro#readme"
								rel="noopener noreferrer"
								target="_blank">
								Learn more
							</a>
						</p>
						{multiRootSetting.featureFlag && (
							<div className="mt-2">
								<VSCodeCheckbox
									checked={multiRootSetting.user}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("multiRootEnabled", checked)
									}}>
									Enable Multi-Root Workspace
								</VSCodeCheckbox>
								<p className="toggle-description">
									<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>
									Allows AI-Hydro to work across multiple workspaces.
								</p>
							</div>
						)}
						{hooksEnabled?.featureFlag && (
							<div className="mt-2">
								<VSCodeCheckbox
									checked={hooksEnabled.user}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("hooksEnabled", checked)
									}}>
									Enable Hooks
								</VSCodeCheckbox>
								<p className="toggle-description">
									<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>
									Allows execution of hooks from .aihydrorules/hooks/ directory.
								</p>
							</div>
						)}
					</div>

					<div className="settings-card">
						<div className="settings-section-header">
							<span className="codicon codicon-warning" />
							Advanced / Dangerous
						</div>
						{remoteConfigSettings?.yoloModeToggled !== undefined ? (
							<HeroTooltip content="This setting is managed by your organization's remote configuration">
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={yoloModeToggled}
										disabled={true}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("yoloModeToggled", checked)
										}}>
										Enable YOLO Mode
									</VSCodeCheckbox>
									<i className="codicon codicon-lock text-[var(--vscode-descriptionForeground)] text-sm" />
								</div>
							</HeroTooltip>
						) : (
							<VSCodeCheckbox
								checked={yoloModeToggled}
								disabled={false}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("yoloModeToggled", checked)
								}}>
								Enable YOLO Mode
							</VSCodeCheckbox>
						)}
						<p className="toggle-description text-[var(--vscode-errorForeground)]">
							EXPERIMENTAL & DANGEROUS: This mode disables safety checks and user confirmations. AI-Hydro will
							automatically approve all actions without asking. Use with extreme caution.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
