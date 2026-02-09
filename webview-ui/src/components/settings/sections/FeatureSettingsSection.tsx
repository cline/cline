import { McpDisplayMode } from "@shared/McpDisplayMode"
import { EmptyRequest } from "@shared/proto/index.beadsmith"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { isMacOSOrLinux } from "@/utils/platformUtils"
import Section from "../Section"
import SubagentOutputLineLimitSlider from "../SubagentOutputLineLimitSlider"
import { updateSetting } from "../utils/settingsHandlers"

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		mcpDisplayMode,
		openaiReasoningEffort,
		strictPlanModeEnabled,
		yoloModeToggled,
		dictationSettings,
		useAutoCondense,
		beadsmithWebToolsEnabled,
		worktreesEnabled,
		focusChainSettings,
		multiRootSetting,
		skillsEnabled,
		remoteConfigSettings,
		subagentsEnabled,
		nativeToolCallSetting,
		enableParallelToolCalling,
		backgroundEditEnabled,
		beadsEnabled,
		beadAutoApprove,
		beadCommitMode,
		beadTestCommand,
		ralphMaxIterations,
		ralphTokenBudget,
		dagEnabled,
		navigateToDag,
	} = useExtensionState()

	const [isBeadsmithCliInstalled, setIsBeadsmithCliInstalled] = useState(false)

	const handleReasoningEffortChange = (newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue)
	}

	// Poll for CLI installation status while the component is mounted
	useEffect(() => {
		const checkInstallation = async () => {
			try {
				const result = await StateServiceClient.checkCliInstallation(EmptyRequest.create())
				setIsBeadsmithCliInstalled(result.value)
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
				<div style={{ marginBottom: 20 }}>
					{/* Subagents - Only show on macOS and Linux */}
					{isMacOSOrLinux() && PLATFORM_CONFIG.type === PlatformType.VSCODE && (
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
										Beadsmith for CLI is required for subagents. Install it with:
										<code
											className="ml-1 px-1 rounded"
											style={{
												backgroundColor: "var(--vscode-editor-background)",
												color: "var(--vscode-foreground)",
												opacity: 0.9,
											}}>
											npm install -g beadsmith
										</code>
										, then run
										<code
											className="ml-1 px-1 rounded"
											style={{
												backgroundColor: "var(--vscode-editor-background)",
												color: "var(--vscode-foreground)",
												opacity: 0.9,
											}}>
											cline auth
										</code>
										To authenticate with Beadsmith or configure an API provider.
									</span>
								</p>
								{!isBeadsmithCliInstalled && (
									<VSCodeButton
										appearance="secondary"
										onClick={async () => {
											try {
												await StateServiceClient.installBeadsmithCli(EmptyRequest.create())
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
								disabled={!isBeadsmithCliInstalled}
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
									Allows Beadsmith to spawn subprocesses to handle focused tasks like exploring large codebases,
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

					<div>
						<VSCodeCheckbox
							checked={enableCheckpointsSetting}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("enableCheckpointsSetting", checked)
							}}>
							Enable Checkpoints
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Enables extension to save checkpoints of workspace throughout the task. Uses git under the hood which
							may not work well with large workspaces.
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="mcp-display-mode-dropdown">
							MCP Display Mode
						</label>
						<McpDisplayModeDropdown
							className="w-full"
							id="mcp-display-mode-dropdown"
							onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
							value={mcpDisplayMode}
						/>
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
							Controls how MCP responses are displayed: plain text, rich formatting with links/images, or markdown
							rendering.
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
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
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
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
						<p className="text-xs text-(--vscode-descriptionForeground)">
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
							<p className="text-xs text-(--vscode-descriptionForeground)">
								Enables enhanced task progress tracking and automatic focus chain list management throughout
								tasks.
							</p>
						</div>
					}
					{focusChainSettings?.enabled && (
						<div style={{ marginTop: 10, marginLeft: 20 }}>
							<label
								className="block text-sm font-medium text-(--vscode-foreground) mb-1"
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
											remindBeadsmithInterval: value,
										})
									}
								}}
								value={String(focusChainSettings?.remindBeadsmithInterval || 6)}
							/>
							<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
								Interval (in messages) to remind Beadsmith about its focus chain checklist (1-100). Lower values
								provide more frequent reminders.
							</p>
						</div>
					)}
					{dictationSettings?.featureEnabled && (
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
								Enables speech-to-text transcription using your Beadsmith account. Uses the Aqua Voice's Avalon
								model, at $0.0065 credits per minute of audio processed. 5 minutes max per message.
							</p>
						</div>
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
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Enables advanced context management system which uses LLM based condensing for next-gen models.{" "}
							<a
								className="text-(--vscode-textLink-foreground) hover:text-(--vscode-textLink-activeForeground)"
								href="https://docs.cline.bot/features/auto-compact"
								rel="noopener noreferrer"
								target="_blank">
								Learn more
							</a>
						</p>
					</div>
					{beadsmithWebToolsEnabled?.featureFlag && (
						<div style={{ marginTop: 10 }}>
							<VSCodeCheckbox
								checked={beadsmithWebToolsEnabled?.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("beadsmithWebToolsEnabled", checked)
								}}>
								Enable Beadsmith Web Tools
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">
								Enables websearch and webfetch tools while using the Beadsmith provider.
							</p>
						</div>
					)}
					{worktreesEnabled?.featureFlag && (
						<div style={{ marginTop: 10 }}>
							<VSCodeCheckbox
								checked={worktreesEnabled?.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("worktreesEnabled", checked)
								}}>
								Enable Worktrees
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">
								Enables git worktree management for running parallel Beadsmith tasks.
							</p>
						</div>
					)}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={nativeToolCallSetting}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked
								updateSetting("nativeToolCallEnabled", enabled)
							}}>
							Enable Native Tool Call
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Uses the model's native tool calling API instead of XML-based tool parsing. This will improve
							performance for supported models.
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={enableParallelToolCalling}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked
								updateSetting("enableParallelToolCalling", enabled)
							}}>
							Enable Parallel Tool Calling
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">Experimental: </span>{" "}
							<span className="text-description">
								Allows models to call multiple tools in a single response. Automatically enabled for GPT-5 models.
							</span>
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={backgroundEditEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("backgroundEditEnabled", checked)
							}}>
							Enable Background Edit
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-error">Experimental: </span>
							<span className="text-description">
								Allows editing files in background without opening the diff view in editor.
							</span>
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
								<span className="text-error">Experimental: </span>{" "}
								<span className="text-description">Allows cline to work across multiple workspaces.</span>
							</p>
						</div>
					)}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={skillsEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("skillsEnabled", checked)
							}}>
							Enable Skills
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">Experimental: </span>{" "}
							<span className="text-description">
								Enables Skills for reusable, on-demand agent instructions from .cline/skills/ directories.
							</span>
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={beadsEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("beadsEnabled", checked)
							}}>
							Enable Beads (Ralph Loop)
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">Experimental: </span>{" "}
							<span className="text-description">
								Enables iterative task execution with approval checkpoints. Each "bead" is a discrete unit of work
								that can be reviewed, approved, or rejected before continuing.
							</span>
						</p>
					</div>
					{beadsEnabled && (
						<div className="ml-5 mt-2 p-3 rounded" style={{ backgroundColor: "var(--vscode-list-hoverBackground)" }}>
							<div className="mb-3">
								<VSCodeCheckbox
									checked={beadAutoApprove}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("beadAutoApprove", checked)
									}}>
									Auto-approve beads
								</VSCodeCheckbox>
								<p className="text-xs text-description">
									Automatically approve beads when success criteria are met, without waiting for manual review.
								</p>
							</div>
							<div className="mb-3">
								<label
									className="block text-sm font-medium text-(--vscode-foreground) mb-1"
									htmlFor="bead-commit-mode">
									Commit Mode
								</label>
								<VSCodeDropdown
									className="w-full"
									currentValue={beadCommitMode || "shadow"}
									id="bead-commit-mode"
									onChange={(e: any) => {
										const value = e.target.currentValue as "shadow" | "workspace"
										updateSetting("beadCommitMode", value)
									}}>
									<VSCodeOption value="shadow">Shadow (hidden branch)</VSCodeOption>
									<VSCodeOption value="workspace">Workspace (current branch)</VSCodeOption>
								</VSCodeDropdown>
								<p className="text-xs text-description mt-1">
									Shadow commits to a hidden branch for easy rollback. Workspace commits to your current working
									branch.
								</p>
							</div>
							<div className="mb-3">
								<label
									className="block text-sm font-medium text-(--vscode-foreground) mb-1"
									htmlFor="bead-test-command">
									Test Command (optional)
								</label>
								<VSCodeTextField
									className="w-full"
									id="bead-test-command"
									onChange={(e: any) => {
										const value = e.target.value || undefined
										updateSetting("beadTestCommand", value)
									}}
									placeholder="npm test"
									value={beadTestCommand || ""}
								/>
								<p className="text-xs text-description mt-1">
									Command to run tests for success criteria validation. If empty, test criteria are skipped.
								</p>
							</div>
							<div className="flex gap-4">
								<div className="flex-1">
									<label
										className="block text-sm font-medium text-(--vscode-foreground) mb-1"
										htmlFor="ralph-max-iterations">
										Max Iterations
									</label>
									<VSCodeTextField
										className="w-20"
										id="ralph-max-iterations"
										onChange={(e: any) => {
											const value = parseInt(e.target.value, 10)
											if (!Number.isNaN(value) && value >= 1 && value <= 100) {
												updateSetting("ralphMaxIterations", value)
											}
										}}
										value={String(ralphMaxIterations || 10)}
									/>
									<p className="text-xs text-description mt-1">Max bead iterations (1-100)</p>
								</div>
								<div className="flex-1">
									<label
										className="block text-sm font-medium text-(--vscode-foreground) mb-1"
										htmlFor="ralph-token-budget">
										Token Budget
									</label>
									<VSCodeTextField
										className="w-32"
										id="ralph-token-budget"
										onChange={(e: any) => {
											const value = parseInt(e.target.value, 10)
											if (!Number.isNaN(value) && value >= 1000) {
												updateSetting("ralphTokenBudget", value)
											}
										}}
										value={String(ralphTokenBudget || 100000)}
									/>
									<p className="text-xs text-description mt-1">Total token budget for task</p>
								</div>
							</div>
						</div>
					)}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={dagEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("dagEnabled", checked)
							}}>
							Enable DAG Analysis
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">Experimental: </span>{" "}
							<span className="text-description">
								Enables dependency graph analysis to understand cross-file impact before making changes. Requires
								Python 3.12+ to be installed.
							</span>
						</p>
						{dagEnabled && (
							<VSCodeButton
								appearance="secondary"
								className="mt-2"
								onClick={() => navigateToDag()}
								style={{ transform: "scale(0.85)", transformOrigin: "left center" }}>
								View Dependency Graph
							</VSCodeButton>
						)}
					</div>
					<div style={{ marginTop: 10 }}>
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={yoloModeToggled}
										disabled={remoteConfigSettings?.yoloModeToggled !== undefined}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("yoloModeToggled", checked)
										}}>
										Enable YOLO Mode
									</VSCodeCheckbox>
									{remoteConfigSettings?.yoloModeToggled !== undefined && (
										<i className="codicon codicon-lock text-description text-sm" />
									)}
								</div>
							</TooltipTrigger>
							<TooltipContent
								className="max-w-xs"
								hidden={remoteConfigSettings?.yoloModeToggled === undefined}
								side="top">
								This setting is managed by your organization's remote configuration
							</TooltipContent>
						</Tooltip>

						<p className="text-xs text-(--vscode-errorForeground)">
							EXPERIMENTAL & DANGEROUS: This mode disables safety checks and user confirmations. Beadsmith will
							automatically approve all actions without asking. Use with extreme caution.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
