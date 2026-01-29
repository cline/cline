import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { EmptyRequest } from "@shared/proto/index.cline"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { AlertCircleIcon } from "lucide-react"
import { memo, type ReactNode, useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { isMacOSOrLinux } from "@/utils/platformUtils"
import Section from "../Section"
import SubagentOutputLineLimitSlider from "../SubagentOutputLineLimitSlider"
import { updateSetting } from "../utils/settingsHandlers"

// Reusable checkbox component for feature settings
interface FeatureCheckboxProps {
	checked: boolean | undefined
	onChange: (checked: boolean) => void
	label: string
	description: ReactNode
	disabled?: boolean
	isExperimental?: boolean
	isRemoteLocked?: boolean
	remoteTooltip?: string
	isVisible?: boolean
}

// Interface for feature toggle configuration
interface FeatureToggle {
	id: string
	label: string
	description: ReactNode
	settingKey: keyof UpdateSettingsRequest
	stateKey: string
	isExperimental?: boolean
	/** If set, the setting value is nested with this key (e.g., "enabled" -> { enabled: checked }) */
	nestedKey?: string
}

const agentFeatures: FeatureToggle[] = [
	{
		id: "native-tool-call",
		label: "Native Tool Call",
		description: "Use native function calling when available",
		stateKey: "nativeToolCallSetting",
		settingKey: "nativeToolCallEnabled",
	},
	{
		id: "parallel-tool-calling",
		label: "Parallel Tool Calling",
		description: "Execute multiple tool calls simultaneously",
		stateKey: "enableParallelToolCalling",
		settingKey: "enableParallelToolCalling",
		isExperimental: true,
	},
	{
		id: "strict-plan-mode",
		label: "Strict Plan Mode",
		description: "Prevents file edits while in Plan mode",
		stateKey: "strictPlanModeEnabled",
		settingKey: "strictPlanModeEnabled",
	},
	{
		id: "auto-compact",
		label: "Auto Compact",
		description: "Automatically compress conversation history.",
		stateKey: "useAutoCondense",
		settingKey: "useAutoCondense",
	},
]

const editorFeatures: FeatureToggle[] = [
	{
		id: "background-edit",
		label: "Background Edit",
		description: "Allow edits without stealing editor focus",
		stateKey: "backgroundEditEnabled",
		settingKey: "backgroundEditEnabled",
		isExperimental: true,
	},
	{
		id: "checkpoints",
		label: "Checkpoints",
		description: "Save progress at key points for easy rollback",
		stateKey: "enableCheckpointsSetting",
		settingKey: "enableCheckpointsSetting",
	},
	{
		id: "cline-web-tools",
		label: "Cline Web Tools",
		description: "Access web browsing and search capabilities",
		stateKey: "clineWebToolsEnabled",
		settingKey: "clineWebToolsEnabled",
	},
	{
		id: "worktrees",
		label: "Worktrees",
		description: "Enables git worktree management for running parallel Cline tasks.",
		stateKey: "worktreesEnabled",
		settingKey: "worktreesEnabled",
	},
]

const experimentalFeatures: FeatureToggle[] = [
	{
		id: "yolo",
		label: "Yolo Mode",
		description:
			"Execute tasks without user's confirmation. Auto-switches from Plan to Act mode and disables the ask question tool. Use with extreme caution.",
		stateKey: "yoloModeToggled",
		settingKey: "yoloModeToggled",
		isExperimental: true,
	},
	{
		id: "focus-chain",
		label: "Focus Chain",
		description: "Maintain context focus across interactions",
		stateKey: "focusChainEnabled",
		settingKey: "focusChainSettings",
		nestedKey: "enabled",
	},
]

const FeatureRow = memo(
	({
		checked = false,
		onChange,
		label,
		description,
		disabled,
		isExperimental,
		isRemoteLocked,
		isVisible = true,
		remoteTooltip,
	}: FeatureCheckboxProps) => {
		if (!isVisible) {
			return null
		}

		const checkbox = (
			<div className="flex items-center justify-between w-full">
				<div>{label}</div>
				<div>
					<Switch
						checked={checked}
						className="shrink-0"
						disabled={disabled || isRemoteLocked}
						id={label}
						onCheckedChange={onChange}
						size="lg"
					/>
					{isRemoteLocked && <i className="codicon codicon-lock text-description text-sm" />}
				</div>
			</div>
		)

		return (
			<div className="flex flex-col items-start justify-between gap-4 py-3 w-full">
				<div className="space-y-0.5 flex-1 w-full">
					{isRemoteLocked ? (
						<Tooltip>
							<TooltipTrigger asChild>{checkbox}</TooltipTrigger>
							<TooltipContent className="max-w-xs" side="top">
								{remoteTooltip}
							</TooltipContent>
						</Tooltip>
					) : (
						checkbox
					)}
				</div>
				<div className="text-xs text-description">
					{isExperimental && <span className="text-info">Experimental: </span>}
					{description}
				</div>
			</div>
		)
	},
)

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

	const handleReasoningEffortChange = useCallback((newValue: OpenaiReasoningEffort) => {
		updateSetting("openaiReasoningEffort", newValue)
	}, [])

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
		const pollInterval = setInterval(checkInstallation, 1500)
		return () => clearInterval(pollInterval)
	}, [])

	const handleInstallCli = useCallback(async () => {
		try {
			await StateServiceClient.installClineCli(EmptyRequest.create())
		} catch (error) {
			console.error("Failed to initiate CLI installation:", error)
		}
	}, [])

	const handleFocusChainIntervalChange = useCallback(
		(e: any) => {
			const value = parseInt(e.target.value, 10)
			if (!Number.isNaN(value) && value >= 1 && value <= 100) {
				updateSetting("focusChainSettings", { ...focusChainSettings, remindClineInterval: value })
			}
		},
		[focusChainSettings],
	)

	const showSubagents = isMacOSOrLinux() && PLATFORM_CONFIG.type === PlatformType.VSCODE
	const isYoloRemoteLocked = remoteConfigSettings?.yoloModeToggled !== undefined

	// State lookup for mapped features
	const featureState: Record<string, boolean | undefined> = {
		enableCheckpointsSetting,
		strictPlanModeEnabled,
		nativeToolCallSetting,
		focusChainEnabled: focusChainSettings?.enabled,
		useAutoCondense,
		clineWebToolsEnabled: clineWebToolsEnabled?.user,
		worktreesEnabled: worktreesEnabled?.user,
		enableParallelToolCalling,
		backgroundEditEnabled,
		skillsEnabled,
		yoloModeToggled: yoloModeToggled && !isYoloRemoteLocked,
		multiRootEnabled: multiRootSetting.user,
		dictationSettings: dictationSettings?.dictationEnabled ?? false,
	}

	// Visibility lookup for features with feature flags
	const featureVisibility: Record<string, boolean | undefined> = {
		clineWebToolsEnabled: clineWebToolsEnabled?.featureFlag,
		worktreesEnabled: worktreesEnabled?.featureFlag,
		dictationSettings: dictationSettings?.featureEnabled,
		multiRootSetting: multiRootSetting.featureFlag,
	}

	// Handler for feature toggle changes, supports nested settings like focusChainSettings
	const handleFeatureChange = useCallback(
		(feature: FeatureToggle, checked: boolean) => {
			if (feature.nestedKey) {
				// For nested settings, spread the existing value and set the nested key
				let currentValue = {}
				if (feature.settingKey === "focusChainSettings") {
					currentValue = focusChainSettings ?? {}
				} else if (feature.settingKey === "dictationSettings") {
					currentValue = dictationSettings ?? {}
				}
				updateSetting(feature.settingKey, { ...currentValue, [feature.nestedKey]: checked })
			} else {
				updateSetting(feature.settingKey, checked)
			}
		},
		[focusChainSettings, dictationSettings],
	)

	return (
		<div className="mb-2">
			{renderSectionHeader("features")}
			<Section>
				<div className="mb-5">
					{/* Core features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Agent</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="agent-features">
							{agentFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isExperimental={feature.isExperimental}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => updateSetting(feature.settingKey, checked)}
								/>
							))}
						</div>
					</div>

					{/* Optional features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Editor</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="optional-features">
							{editorFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isExperimental={feature.isExperimental}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => handleFeatureChange(feature, checked)}
								/>
							))}
						</div>
					</div>

					{/* Experimental features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Experimental</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="experimental-features">
							{/* Subagents - Only show on macOS and Linux */}
							{showSubagents && (
								<>
									<FeatureRow
										checked={subagentsEnabled}
										description="Delegate tasks to specialized sub-agents (experimental)"
										disabled={!isClineCliInstalled}
										label="Subagents"
										onChange={(checked) => updateSetting("subagentsEnabled", checked)}
									/>
									<div className="mt-1.5 mb-2 px-2 pt-0.5 pb-1.5 rounded">
										<p className="text-xs mb-2 flex items-start text-input-warning-foreground">
											<span>
												<AlertCircleIcon className="inline-flex !size-1 mr-1" />
												Cline CLI is required for subagents. Install it with
												<code className="px-1">npm install -g cline</code>, then run
												<code className="px-1">cline auth</code>
												to authenticate with Cline or configure an API provider.
											</span>
										</p>
										{!isClineCliInstalled && (
											<Button className="w-full" onClick={handleInstallCli} variant="secondary">
												Install Now
											</Button>
										)}
									</div>
									{subagentsEnabled && (
										<div className="mt-3">
											<SubagentOutputLineLimitSlider />
										</div>
									)}
								</>
							)}
							{experimentalFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isExperimental={feature.isExperimental}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => handleFeatureChange(feature, checked)}
								/>
							))}
							{focusChainSettings?.enabled && (
								<div className="mt-2 p-3 rounded-md bg-editor-widget-background/30 border border-editor-widget-border/30">
									<div className="flex items-center justify-between gap-4">
										<div className="space-y-0.5 flex-1">
											<Label className="text-xs font-medium text-description">
												Reminder Interval (1-10)
											</Label>
										</div>
										<span className="text-sm font-mono text-foreground w-6 text-right">
											{focusChainSettings?.remindClineInterval}
										</span>
									</div>
									<Slider
										className="mt-2"
										max={10}
										min={1}
										onValueChange={(e) => handleFocusChainIntervalChange({ target: { value: e[0] } })}
										step={1}
										value={[focusChainSettings?.remindClineInterval || 6]}
									/>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Advanced */}
				<div>
					<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Advanced</div>
					<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="advanced-features">
						<div className="space-y-3">
							{/* OAI Reasoning Effort */}
							<div className="space-y-2">
								<Label className="text-sm font-medium text-foreground">OpenAI Reasoning Effort</Label>
								<p className="text-xs text-muted-foreground">
									Control the depth of reasoning for OpenAI o-series models
								</p>
								<Select
									onValueChange={(v) => handleReasoningEffortChange(v as OpenaiReasoningEffort)}
									value={openaiReasoningEffort || "medium"}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="low">Minimal</SelectItem>
										<SelectItem value="low">Low</SelectItem>
										<SelectItem value="medium">Medium</SelectItem>
										<SelectItem value="high">High</SelectItem>
									</SelectContent>
								</Select>
							</div>

							{/* MCP Display Mode */}
							<div className="space-y-2">
								<Label className="text-sm font-medium text-foreground">MCP Display Mode</Label>
								<p className="text-xs text-muted-foreground">Controls how MCP responses are displayed</p>
								<Select onValueChange={(v) => updateSetting("mcpDisplayMode", v)} value={mcpDisplayMode}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="plain">Plain Text</SelectItem>
										<SelectItem value="rich">Rich Display</SelectItem>
										<SelectItem value="markdown">Markdown</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
export default FeatureSettingsSection
