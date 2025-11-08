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
		nativeToolCallSetting,
	} = useExtensionState()

	const [isClineCliInstalled, setIsClineCliInstalled] = useState(false)
	const { t } = useTranslation("common")

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
								{t("settings.features.subagents.new_badge")}
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
										{t("settings.features.subagents.warning_message")}
										<code
											className="ml-1 px-1 rounded"
											style={{
												backgroundColor: "var(--vscode-editor-background)",
												color: "var(--vscode-foreground)",
												opacity: 0.9,
											}}>
											{t("settings.features.subagents.install_command")}
										</code>
										, then run
										<code
											className="ml-1 px-1 rounded"
											style={{
												backgroundColor: "var(--vscode-editor-background)",
												color: "var(--vscode-foreground)",
												opacity: 0.9,
											}}>
											{t("settings.features.subagents.auth_command")}
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
										{t("settings.features.subagents.install_now_button")}
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
										? t("settings.features.subagents.checkbox_label_enabled")
										: t("settings.features.subagents.checkbox_label_disabled")}
								</span>
							</VSCodeCheckbox>
							<p className="text-xs mt-1 mb-0">
								<span className="text-[var(--vscode-errorForeground)]">
									{t("settings.features.subagents.experimental_tag")}{" "}
								</span>{" "}
								<span className="text-description">{t("settings.features.subagents.description")}</span>
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
							{t("settings.features.enable_checkpoints")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("settings.features.enable_checkpoints_description")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<Tooltip>
							<TooltipTrigger>
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={mcpMarketplaceEnabled}
										disabled={remoteConfigSettings?.mcpMarketplaceEnabled !== undefined}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("mcpMarketplaceEnabled", checked)
										}}>
										{t("settings.features.enable_mcp_marketplace")}
									</VSCodeCheckbox>
									{remoteConfigSettings?.mcpMarketplaceEnabled !== undefined && (
										<i className="codicon codicon-lock text-description text-sm" />
									)}
								</div>
							</TooltipTrigger>
							<TooltipContent hidden={remoteConfigSettings?.mcpMarketplaceEnabled === undefined}>
								This setting is managed by your organization's remote configuration
							</TooltipContent>
						</Tooltip>

						<p className="text-xs text-description">{t("settings.features.enable_mcp_marketplace_description")}</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="mcp-display-mode-dropdown">
							{t("settings.features.mcp_display_mode")}
						</label>
						<McpDisplayModeDropdown
							className="w-full"
							id="mcp-display-mode-dropdown"
							onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
							value={mcpDisplayMode}
						/>
						<p className="text-xs mt-[5px] text-(--vscode-descriptionForeground)">
							{t("settings.features.mcp_display_mode_description")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={mcpResponsesCollapsed}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("mcpResponsesCollapsed", checked)
							}}>
							{t("settings.features.collapse_mcp_responses")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("settings.features.collapse_mcp_responses_description")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<label
							className="block text-sm font-medium text-(--vscode-foreground) mb-1"
							htmlFor="openai-reasoning-effort-dropdown">
							{t("settings.features.openai_reasoning_effort")}
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
							{t("settings.features.openai_reasoning_effort_description")}
						</p>
					</div>
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={strictPlanModeEnabled}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("strictPlanModeEnabled", checked)
							}}>
							{t("settings.features.enable_strict_plan_mode")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("settings.features.enable_strict_plan_mode_description")}
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
								{t("settings.features.enable_focus_chain")}
							</VSCodeCheckbox>
							<p className="text-xs text-(--vscode-descriptionForeground)">
								{t("settings.features.enable_focus_chain_description")}
							</p>
						</div>
					}
					{focusChainSettings?.enabled && (
						<div style={{ marginTop: 10, marginLeft: 20 }}>
							<label
								className="block text-sm font-medium text-(--vscode-foreground) mb-1"
								htmlFor="focus-chain-remind-interval">
								{t("settings.features.focus_chain_reminder_interval")}
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
								{t("settings.features.focus_chain_reminder_interval_description")}
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
								{t("settings.features.enable_dictation")}
							</VSCodeCheckbox>
							<p className="text-xs text-description mt-1">{t("settings.features.enable_dictation_description")}</p>
						</div>
					)}
					<div style={{ marginTop: 10 }}>
						<VSCodeCheckbox
							checked={useAutoCondense}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("useAutoCondense", checked)
							}}>
							{t("settings.features.enable_auto_compact")}
						</VSCodeCheckbox>
						<p className="text-xs text-(--vscode-descriptionForeground)">
							{t("settings.features.enable_auto_compact_description")}{" "}
							<a
								className="text-(--vscode-textLink-foreground) hover:text-(--vscode-textLink-activeForeground)"
								href="https://docs.cline.bot/features/auto-compact"
								rel="noopener noreferrer"
								target="_blank">
								{t("settings.features.learn_more_link")}
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
								{t("settings.features.enable_multi_root_workspace")}
							</VSCodeCheckbox>
							<p className="text-xs">
								<span className="text-(--vscode-errorForeground)">
									{t("settings.features.subagents.experimental_tag")}{" "}
								</span>{" "}
								<span className="text-description">
									{t("settings.features.enable_multi_root_workspace_description")}
								</span>
							</p>
						</div>
					)}
					<div className="mt-2.5">
						<VSCodeCheckbox
							checked={hooksEnabled?.user}
							disabled={!isMacOSOrLinux()}
							onChange={(e: any) => {
								const checked = e.target.checked === true
								updateSetting("hooksEnabled", checked)
							}}>
							{t("settings.features.enable_hooks")}
						</VSCodeCheckbox>
						{!isMacOSOrLinux() ? (
							<p className="text-xs mt-1" style={{ color: "var(--vscode-inputValidation-warningForeground)" }}>
								{t("settings.features.enable_hooks_not_supported")}
							</p>
						) : (
							<p className="text-xs">
								<span className="text-(--vscode-errorForeground)">
									{t("settings.features.subagents.experimental_tag")}{" "}
								</span>{" "}
								<span className="text-description">{t("settings.features.enable_hooks_description")}</span>
							</p>
						)}
					</div>
					{nativeToolCallSetting?.featureFlag && (
						<div className="mt-2.5">
							<VSCodeCheckbox
								checked={nativeToolCallSetting?.user}
								onChange={(e) => {
									const enabled = (e?.target as HTMLInputElement).checked
									updateSetting("nativeToolCallEnabled", enabled)
								}}>
								{t("settings.features.enable_native_tool_call")}
							</VSCodeCheckbox>
							<p className="text-xs">
								<span className="text-[var(--vscode-errorForeground)]">
									{t("settings.features.subagents.experimental_tag")}{" "}
								</span>{" "}
								<span className="text-description">
									{t("settings.features.enable_native_tool_call_description")}
								</span>
							</p>
						</div>
					)}
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
										{t("settings.features.enable_yolo_mode")}
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
							{t("settings.features.enable_yolo_mode_description")}
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
