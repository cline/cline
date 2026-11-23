import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { memo, type ReactNode } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import { featureSettingControlId, featureSettingElementId } from "../settingsTargets"
import { updateSetting } from "../utils/settingsHandlers"

interface FeatureCheckboxProps {
	id?: string
	checked: boolean | undefined
	onChange: (checked: boolean) => void
	label: string
	description: ReactNode
	disabled?: boolean
	isRemoteLocked?: boolean
	remoteTooltip?: string
	isVisible?: boolean
}

interface FeatureToggle {
	id: string
	label: string
	description: ReactNode
	settingKey: keyof UpdateSettingsRequest
	stateKey: string
}

const agentFeatures: FeatureToggle[] = [
	{
		id: "auto-compact",
		label: "Auto Compact",
		description: "Automatically compress conversation history when approaching the context limit.",
		stateKey: "useAutoCondense",
		settingKey: "useAutoCondense",
	},
]

const editorFeatures: FeatureToggle[] = [
	{
		id: "checkpoints",
		label: "Checkpoints",
		description: "Save workspace snapshots at key steps so you can roll back edits safely.",
		stateKey: "enableCheckpointsSetting",
		settingKey: "enableCheckpointsSetting",
	},
	{
		id: "background-edit",
		label: "Background Edit",
		description: "Apply file edits without stealing focus from your current editor.",
		stateKey: "backgroundEditEnabled",
		settingKey: "backgroundEditEnabled",
	},
	{
		id: "worktrees",
		label: "Worktrees",
		description: "Enable git worktree management for running parallel Cline tasks.",
		stateKey: "worktreesEnabled",
		settingKey: "worktreesEnabled",
	},
	{
		id: "show-feature-tips",
		label: "Feature Tips",
		description: "Show rotating hints during thinking phases.",
		stateKey: "showFeatureTips",
		settingKey: "showFeatureTips",
	},
]

const advancedFeatures: FeatureToggle[] = [
	{
		id: "hooks",
		label: "Hooks",
		description: "Enable lifecycle and tool hooks during task execution.",
		stateKey: "hooksEnabled",
		settingKey: "hooksEnabled",
	},
]

const FeatureRow = memo(
	({
		id,
		checked = false,
		onChange,
		label,
		description,
		disabled,
		isRemoteLocked,
		isVisible = true,
		remoteTooltip,
	}: FeatureCheckboxProps) => {
		if (!isVisible) {
			return null
		}
		const switchId = id ? featureSettingControlId(id) : label

		const control = (
			<div className="flex items-center justify-between gap-4 w-full">
				<div className="flex flex-col gap-0.5 min-w-0">
					<label className="text-[13.5px] font-medium text-[#eceef0] cursor-pointer" htmlFor={switchId}>
						{label}
					</label>
					<div className="text-[12px] text-[#858b94] leading-relaxed">{description}</div>
				</div>
				<div className="flex items-center gap-1.5 shrink-0">
					<Switch
						checked={checked}
						className="shrink-0"
						disabled={disabled || isRemoteLocked}
						id={switchId}
						onCheckedChange={onChange}
						size="lg"
					/>
					{isRemoteLocked && <i className="codicon codicon-lock text-description text-sm" />}
				</div>
			</div>
		)

		return (
			<div
				className="py-3.5 first:pt-3 last:pb-3 w-full rounded-xs border border-transparent"
				id={id ? featureSettingElementId(id) : undefined}>
				{isRemoteLocked ? (
					<Tooltip>
						<TooltipTrigger asChild>{control}</TooltipTrigger>
						<TooltipContent className="max-w-xs" side="top">
							{remoteTooltip}
						</TooltipContent>
					</Tooltip>
				) : (
					control
				)}
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
		hooksEnabled,
		mcpDisplayMode,
		useAutoCondense,
		compactionStrategy,
		webSearchEnabled,
		subagentsEnabled,
		worktreesEnabled,
		backgroundEditEnabled,
		showFeatureTips,
		cloudSessionsAvailable,
		cloudSessionsEnabled,
	} = useExtensionState()

	const featureState: Record<string, boolean | undefined> = {
		showFeatureTips,
		enableCheckpointsSetting,
		hooksEnabled,
		useAutoCondense,
		subagentsEnabled,
		worktreesEnabled: worktreesEnabled?.user,
		backgroundEditEnabled,
	}

	const featureVisibility: Record<string, boolean | undefined> = {
		worktreesEnabled: worktreesEnabled?.featureFlag,
	}

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				{/* Agent */}
				<div>
					<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
						Agent
					</div>
					<div
						className="rounded-xl bg-[#151618] border border-white/[0.08] px-4 divide-y divide-white/[0.06]"
						id="agent-features">
						{agentFeatures.map((feature) => (
							<FeatureRow
								checked={featureState[feature.stateKey]}
								description={feature.description}
								id={feature.id}
								isVisible={featureVisibility[feature.stateKey] ?? true}
								key={feature.id}
								label={feature.label}
								onChange={(checked) => updateSetting(feature.settingKey, checked)}
							/>
						))}
						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5">
							<div className="flex flex-col gap-0.5">
								<Label className="text-[13.5px] font-medium text-[#eceef0]">Auto Compact Strategy</Label>
								<p className="text-[12px] text-[#858b94] m-0">Controls how auto compaction rewrites context.</p>
							</div>
							<Select
								disabled={!useAutoCondense}
								onValueChange={(value) => updateSetting("compactionStrategy", value)}
								value={compactionStrategy ?? "agentic"}>
								<SelectTrigger className="w-full sm:w-44">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="basic">Basic</SelectItem>
									<SelectItem value="agentic">Agentic</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<FeatureRow
							checked={webSearchEnabled}
							description="Allow web search when supported by the active provider and model."
							label="Web Search"
							onChange={(checked) => updateSetting("webSearchEnabled", checked)}
						/>
						<FeatureRow
							checked={cloudSessionsEnabled}
							description="Run Cline on GitHub repositories in cloud sandboxes."
							id="cloud-sessions"
							isVisible={!!cloudSessionsAvailable}
							label="Cloud Sessions"
							onChange={(checked) => updateSetting("cloudSessionsEnabled", checked)}
						/>
					</div>
				</div>

				{/* Editor */}
				<div>
					<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
						Editor & Workflow
					</div>
					<div
						className="rounded-xl bg-[#151618] border border-white/[0.08] px-4 divide-y divide-white/[0.06]"
						id="optional-features">
						{editorFeatures.map((feature) => (
							<FeatureRow
								checked={featureState[feature.stateKey]}
								description={feature.description}
								id={feature.id}
								isVisible={featureVisibility[feature.stateKey] ?? true}
								key={feature.id}
								label={feature.label}
								onChange={(checked) => updateSetting(feature.settingKey, checked)}
							/>
						))}
					</div>
				</div>

				{/* Advanced */}
				<div>
					<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
						Advanced & MCP
					</div>
					<div
						className="rounded-xl bg-[#151618] border border-white/[0.08] px-4 divide-y divide-white/[0.06]"
						id="advanced-features">
						{advancedFeatures.map((feature) => (
							<FeatureRow
								checked={featureState[feature.stateKey]}
								description={feature.description}
								id={feature.id}
								isVisible={featureVisibility[feature.stateKey] ?? true}
								key={feature.id}
								label={feature.label}
								onChange={(checked) => updateSetting(feature.settingKey, checked)}
							/>
						))}

						<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5">
							<div className="flex flex-col gap-0.5">
								<Label className="text-[13.5px] font-medium text-[#eceef0]">MCP Display Mode</Label>
								<p className="text-[12px] text-[#858b94] m-0">Controls how MCP tool responses are formatted.</p>
							</div>
							<Select onValueChange={(v) => updateSetting("mcpDisplayMode", v)} value={mcpDisplayMode}>
								<SelectTrigger className="w-full sm:w-44">
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
			</Section>
		</div>
	)
}
export default memo(FeatureSettingsSection)
