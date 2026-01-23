import { McpDisplayMode } from "@shared/McpDisplayMode"
import { EmptyRequest } from "@shared/proto/index.cline"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
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
	const { t } = useTranslation()
	const {
		enableCheckpointsSetting,
		mcpDisplayMode,
		openaiReasoningEffort,
		strictPlanModeEnabled,
		yoloModeToggled,
		dictationSettings,
		useAutoCondense,
		clineWebToolsEnabled,
		worktreesEnabled,
		focusChainSettings,
		multiRootSetting,
		skillsEnabled,
		remoteConfigSettings,
		subagentsEnabled,
		nativeToolCallSetting,
		enableParallelToolCalling,
		backgroundEditEnabled,
	} = useExtensionState()

	const [isClineCliInstalled, setIsClineCliInstalled] = useState(false)

	const handleReasoningEffortChange = (newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue)
	}

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
		const pollInterval = setInterval(checkInstallation, 1500)
		return () => clearInterval(pollInterval)
	}, [])

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				<div style={{ marginBottom: 20 }}>
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
								{t("featureSettings.new")}
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
										{t("featureSettings.clineCliRequired")}
										<code
											className="ml-1 px-1 rounded"
											style={{
												backgroundColor: "var(--vscode-editor-background)",
												color: "var(--vscode-foreground)",
												opacity: 0.9,
											}}>
											npm install -g cline
										</code>
										{t("featureSettings.thenRun")}
										<code
											className="ml-1 px-1 rounded"
											style={{
												backgroundColor: "var(--vscode-editor-background)",
												color: "var(--vscode-foreground)",
												opacity: 0.9,
											}}>
											cline auth
										</code>
										{t("featureSettings.toAuthenticate")}
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
										{t("featureSettings.installNow")}
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
									{subagentsEnabled
										? t("featureSettings.subagentsEnabled")
										: t("featureSettings.enableSubagents")}
								</span>
							</VSCodeCheckbox>
							<p className="text-xs mt-1 mb-0">
								<span className="text-[var(--vscode-errorForeground)]">{t("featureSettings.experimental")} </span>{" "}
								<span className="text-description">{t("featureSettings.subagentsDescription")}</span>
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
							{t("featureSettings.enableCheckpoints")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("featureSettings.checkpointsDescription")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="mcp-display-mode-dropdown">
							{t("featureSettings.mcpDisplayMode")}
						</label>
						<McpDisplayModeDropdown
							className="w-full"
							id="mcp-display-mode-dropdown"
							onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
							value={mcpDisplayMode}
						/>
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
							{t("featureSettings.mcpDisplayModeDescription")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="openai-reasoning-effort-dropdown">
							{t("featureSettings.openaiReasoningEffort")}
						</label>
						<VSCodeDropdown
							className="w-full"
							currentValue={openaiReasoningEffort || "medium"}
							id="openai-reasoning-effort-dropdown"
							onChange={(e: any) => {
								const newValue = e.target.currentValue as OpenaiReasoningEffort
								handleReasoningEffortChange(newValue)
							}}>
							<VSCodeOption value="minimal">{t("featureSettings.minimal")}</VSCodeOption>
							<VSCodeOption value="low">{t("featureSettings.low")}</VSCodeOption>
							<VSCodeOption value="medium">{t("featureSettings.medium")}</VSCodeOption>
							<VSCodeOption value="high">{t("featureSettings.high")}</VSCodeOption>
						</VSCodeDropdown>
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
							{t("featureSettings.openaiReasoningEffortDescription")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={strictPlanModeEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("strictPlanModeEnabled", checked)
							}}>
							{t("featureSettings.enableStrictPlanMode")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("featureSettings.strictPlanModeDescription")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={focusChainSettings?.enabled || false}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
							}}>
							{t("featureSettings.enableFocusChain")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("featureSettings.focusChainDescription")}
						</p>
					</div>
					{focusChainSettings?.enabled && (
						<div style={{ marginTop: 10, marginLeft: 20 }}>
							<label
								className="block text-sm font-medium text-(--vscode-foreground) mb-1"
								htmlFor="focus-chain-remind-interval">
								{t("featureSettings.focusChainReminderInterval")}
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
								{t("featureSettings.focusChainReminderDescription")}
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
								{t("featureSettings.enableDictation")}
							</VSCodeCheckbox>
							<p className="text-xs text-description mt-1">{t("featureSettings.dictationDescription")}</p>
						</div>
					)}
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={useAutoCondense}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("useAutoCondense", checked)
							}}>
							{t("featureSettings.enableAutoCompact")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("featureSettings.autoCompactDescription")}{" "}
							<a
								className="text-(--vscode-textLink-foreground) hover:text-(--vscode-textLink-activeForeground)"
								href="https://docs.cline.bot/features/auto-compact"
								rel="noopener noreferrer"
								target="_blank">
								{t("featureSettings.learnMore")}
							</a>
						</p>
					</div>
					{clineWebToolsEnabled?.featureFlag && (
						<div style={{ marginTop: 10 }}>
							<VSCodeCheckbox
								checked={clineWebToolsEnabled?.user}
								onChange={(e: any) => {
									const checked = e.target.checked === true
									updateSetting("clineWebToolsEnabled", checked)
								}}>
								{t("featureSettings.enableClineWebTools")}
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">
								{t("featureSettings.clineWebToolsDescription")}
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
								{t("featureSettings.enableWorktrees")}
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">
								{t("featureSettings.worktreesDescription")}
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
							{t("featureSettings.enableNativeToolCall")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("featureSettings.nativeToolCallDescription")}
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={enableParallelToolCalling}
							onChange={(e) => {
								const enabled = (e?.target as HTMLInputElement).checked
								updateSetting("enableParallelToolCalling", enabled)
							}}>
							{t("featureSettings.enableParallelToolCalling")}
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">{t("featureSettings.experimental")} </span>{" "}
							<span className="text-description">{t("featureSettings.parallelToolCallingDescription")}</span>
						</p>
					</div>
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={backgroundEditEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("backgroundEditEnabled", checked)
							}}>
							{t("featureSettings.enableBackgroundEdit")}
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-error">{t("featureSettings.experimental")} </span>
							<span className="text-description">{t("featureSettings.backgroundEditDescription")}</span>
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
								{t("featureSettings.enableMultiRootWorkspace")}
							</VSCodeCheckbox>
							<p className="text-xs">
								<span className="text-error">{t("featureSettings.experimental")} </span>{" "}
								<span className="text-description">{t("featureSettings.multiRootWorkspaceDescription")}</span>
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
							{t("featureSettings.enableSkills")}
						</VSCodeCheckbox>
						<p className="text-xs">
							<span className="text-(--vscode-errorForeground)">{t("featureSettings.experimental")} </span>{" "}
							<span className="text-description">{t("featureSettings.skillsDescription")}</span>
						</p>
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
										{t("featureSettings.enableYoloMode")}
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
								{t("featureSettings.remoteConfigManaged")}
							</TooltipContent>
						</Tooltip>

						<p className="text-xs text-(--vscode-errorForeground)">{t("featureSettings.yoloModeWarning")}</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
