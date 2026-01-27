import { EmptyRequest } from "@shared/proto/index.cline"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
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
		yoloModeToggled,
		useAutoCondense,
		clineWebToolsEnabled,
		worktreesEnabled,
		focusChainSettings,
		remoteConfigSettings,
		subagentsEnabled,
		nativeToolCallSetting,
		enableParallelToolCalling,
		backgroundEditEnabled,
	} = useExtensionState()

	const [isClineCliInstalled, setIsClineCliInstalled] = useState(false)

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
					{/* ==================== DEFAULT ON SECTION ==================== */}

					{/* Checkpoints */}
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

					{/* Native Tool Call */}
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

					{/* Parallel Tool Calling */}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={enableParallelToolCalling}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked
								updateSetting("enableParallelToolCalling", enabled)
							}}>
							Enable Parallel Tool Calling
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							Allows models to call multiple tools in a single response. Automatically enabled for GPT-5 models.
						</p>
					</div>

					{/* Focus Chain */}
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
							Enables enhanced task progress tracking and automatic focus chain list management throughout tasks.
						</p>
					</div>

					{/* Focus Chain Interval (sub-setting) */}
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
											remindClineInterval: value,
										})
									}
								}}
								value={String(focusChainSettings?.remindClineInterval || 6)}
							/>
							<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
								Interval (in messages) to remind Cline about its focus chain checklist (1-100). Lower values
								provide more frequent reminders.
							</p>
						</div>
					)}

					{/* Cline Web Tools */}
					{clineWebToolsEnabled?.featureFlag && (
						<div style={{ marginTop: 10 }}>
							<VSCodeCheckbox
								checked={clineWebToolsEnabled?.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("clineWebToolsEnabled", checked)
								}}>
								Enable Cline Web Tools
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">
								Enables websearch and webfetch tools while using the Cline provider.
							</p>
						</div>
					)}

					{/* ==================== DEFAULT OFF SECTION ==================== */}

					{/* Subagents - Only show on macOS and Linux */}
					{isMacOSOrLinux() && PLATFORM_CONFIG.type === PlatformType.VSCODE && (
						<div
							className="relative p-3 mt-4 mb-3 rounded-md"
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
										To authenticate with Cline or configure an API provider.
									</span>
								</p>
								{!isClineCliInstalled && (
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
								)}
							</div>
							<VSCodeCheckbox
								checked={subagentsEnabled}
								disabled={!isClineCliInstalled}
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
									Allows Cline to spawn subprocesses to handle focused tasks like exploring large codebases,
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

					{/* Auto Compact */}
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

					{/* Background Edit */}
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

					{/* Auto Approve All */}
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
										Auto Approve All
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
							CAUTION: Automatically approves all tool actions without confirmation, switches from Plan to Act mode,
							and disables clarifying questions. Use with extreme caution.
						</p>
					</div>

					{/* Worktrees */}
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
								Enables git worktree management for running parallel Cline tasks.
							</p>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
