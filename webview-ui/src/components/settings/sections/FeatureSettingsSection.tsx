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
		hooksEnabled,
		remoteConfigSettings,
		subagentsEnabled,
	} = useExtensionState()

	const [isClineCliInstalled, setIsClineCliInstalled] = useState(false)

	const handleReasoningEffortChange = (newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue)
	}

	// Poll for CLI installation status while the component is mounted
	useEffect(() => {
		const checkInstallation = async () => {
			try {
				const result = await StateServiceClient.checkCliInstallation(EmptyRequest.create())
				setIsClineCliInstalled(result.value)
			} catch (error) {
				console.error("Failed to check CLI installation:", error)
			}
		}

		// Check immediately when component mounts
		checkInstallation()

		// Set up polling interval (every 1.5 seconds)
		const pollInterval = setInterval(checkInstallation, 1500)

		// Clean up interval when component unmounts
		return () => {
			clearInterval(pollInterval)
		}
	}, [])

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					{/* Subagents - Featured at top */}
					<div
						className="relative p-3 mb-3 rounded-md"
						id="subagents-section"
						style={{
							border: "1px solid var(--vscode-widget-border)",
							backgroundColor: "var(--vscode-list-hoverBackground)",
						}}>
						<div
							className="absolute -top-2 -right-2 px-2 py-0.5 rounded text-xs font-semibold"
							style={{
								backgroundColor: "var(--vscode-button-secondaryBackground)",
								color: "var(--vscode-button-secondaryForeground)",
							}}>
							NEW
						</div>
						{!isClineCliInstalled && (
							<div
								className="mt-1.5 mb-2 px-2 pt-0.5 pb-1.5 rounded"
								style={{
									backgroundColor: "color-mix(in srgb, var(--vscode-sideBar-background) 99%, black)",
								}}>
								<p
									className="text-xs mb-2 flex items-start"
									style={{ color: "var(--vscode-inputValidation-warningForeground)" }}>
									<span
										className="codicon codicon-warning mr-1"
										style={{ fontSize: "12px", marginTop: "1px", flexShrink: 0 }}></span>
									<span>
										Cline for CLI is required for subagents. Install it with:
										<code
											className="ml-1 px-1 rounded"
											style={{
												backgroundColor: "var(--vscode-editor-background)",
												color: "var(--vscode-foreground)",
												opacity: 0.9,
											}}>
											npm install -g cline
										</code>
									</span>
								</p>
								<VSCodeButton
									appearance="secondary"
									onClick={async () => {
										try {
											await StateServiceClient.installClineCli(EmptyRequest.create())
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
							</div>
						)}
						<VSCodeCheckbox
							checked={subagentsEnabled}
							disabled={!isClineCliInstalled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("subagentsEnabled", checked)
							}}>
							<span className="font-semibold">
								{subagentsEnabled ? (
									<>
										<span
											className="codicon codicon-check"
											style={{ marginRight: "4px", color: "var(--vscode-charts-green)" }}></span>
										Subagents Enabled
									</>
								) : (
									"Enable Subagents"
								)}
							</span>
						</VSCodeCheckbox>
						<p className="text-xs mt-1 mb-0">
							<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>{" "}
							<span className="text-description">
								Allows Cline to spawn subprocesses to handle focused tasks like exploring large codebases, keeping
								your main context clean.
							</span>
						</p>
					</div>

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
					{hooksEnabled?.featureFlag && (
						<div className="mt-2.5">
							<VSCodeCheckbox
								checked={hooksEnabled.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("hooksEnabled", checked)
								}}>
								Enable Hooks
							</VSCodeCheckbox>
							<p className="text-xs">
								<span className="text-[var(--vscode-errorForeground)]">Experimental: </span>{" "}
								<span className="text-description">
									Allows execution of hooks from .clinerules/hooks/ directory.
								</span>
							</p>
						</div>
					)}
					<div style={{ marginTop: 10 }}>
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
