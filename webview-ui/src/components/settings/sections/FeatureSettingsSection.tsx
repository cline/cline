import { McpDisplayMode } from "@shared/McpDisplayMode"
import { EmptyRequest } from "@shared/proto/index.cline"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { isMacOSOrLinux } from "@/utils/platformUtils"
import { FeatureGroup } from "../FeatureGroup"
import { FeatureItem } from "../FeatureItem"
import { type NewFeature } from "../NewFeaturesCallout"
import Section from "../Section"
import SubagentOutputLineLimitSlider from "../SubagentOutputLineLimitSlider"
import { updateSetting } from "../utils/settingsHandlers"

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

// Define new features to highlight
const NEW_FEATURES: NewFeature[] = [
	{
		id: "subagents-2025-01",
		label: "Subagents",
		description: "Spawn subprocesses to handle focused tasks like exploring large codebases",
	},
	{
		id: "background-edit-2025-01",
		label: "Background Edit",
		description: "Edit files without opening the diff view in editor",
	},
	{
		id: "parallel-tools-2025-01",
		label: "Parallel Tool Calling",
		description: "Call multiple tools in a single response (auto-enabled for GPT-5)",
	},
]

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
		hooksEnabled,
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

	// Track dismissed new features callout
	const [dismissedFeatures, setDismissedFeatures] = useState<string[]>(() => {
		const stored = localStorage.getItem("dismissedNewFeatures")
		return stored ? JSON.parse(stored) : []
	})

	const visibleNewFeatures = NEW_FEATURES.filter((f) => !dismissedFeatures.includes(f.id))

	const handleDismissNewFeatures = () => {
		const allIds = NEW_FEATURES.map((f) => f.id)
		setDismissedFeatures(allIds)
		localStorage.setItem("dismissedNewFeatures", JSON.stringify(allIds))
	}

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				{/* NEW FEATURES CALLOUT */}
				{visibleNewFeatures.length > 0 && (
					<div
						className="mb-6 rounded-md p-4"
						style={{
							border: "1px solid color-mix(in srgb, var(--vscode-button-background) 30%, transparent)",
							backgroundColor: "color-mix(in srgb, var(--vscode-button-background) 10%, transparent)",
							position: "relative",
						}}>
						<button
							aria-label="Dismiss"
							className="absolute top-2 right-2 p-1 rounded hover:bg-white/10 transition-colors"
							onClick={handleDismissNewFeatures}
							style={{ color: "var(--vscode-descriptionForeground)" }}>
							<i className="codicon codicon-close" />
						</button>

						<div className="flex items-start gap-3">
							<div className="flex-shrink-0 mt-0.5">
								<i
									className="codicon codicon-sparkle"
									style={{ color: "var(--vscode-button-background)", fontSize: "20px" }}
								/>
							</div>

							<div className="flex-1">
								<h3 className="text-sm font-semibold mb-2" style={{ color: "var(--vscode-foreground)" }}>
									New Features Available
								</h3>

								<ul className="space-y-2">
									{visibleNewFeatures.map((feature) => (
										<li className="text-xs" key={feature.id}>
											<span className="font-medium" style={{ color: "var(--vscode-foreground)" }}>
												{feature.label}
											</span>
											<span style={{ color: "var(--vscode-descriptionForeground)" }}>
												{" "}
												— {feature.description}
											</span>
										</li>
									))}
								</ul>
							</div>
						</div>
					</div>
				)}

				{/* GRID CONTAINER FOR FEATURE GROUPS */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					{/* CORE BEHAVIOR & SAFETY */}
					<FeatureGroup
						description="Controls guardrails, confirmations, and overall risk tolerance."
						isGridItem
						title="Core Behavior & Safety">
						<FeatureItem
							badge={{ text: "Dangerous", variant: "dangerous" }}
							checked={yoloModeToggled}
							description="DANGEROUS: Disables safety checks and user confirmations. Cline will automatically approve all actions."
							disabled={remoteConfigSettings?.yoloModeToggled !== undefined}
							label="Enable YOLO Mode"
							onChange={(checked) => updateSetting("yoloModeToggled", checked)}
						/>
					</FeatureGroup>

					{/* REASONING & DECISION MAKING */}
					<FeatureGroup
						description="Defines how much effort the model applies when thinking and planning."
						isGridItem
						title="Reasoning & Decision Making">
						<div>
							<label
								className="block text-sm font-medium text-(--vscode-foreground) mb-2"
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
						</div>
					</FeatureGroup>

					{/* TASK EXECUTION & PROGRESS TRACKING */}
					<FeatureGroup
						description="Manages how work is structured, tracked, and resumed."
						isGridItem
						title="Task Execution & Progress Tracking">
						<FeatureItem
							badge={{ text: "Recommended", variant: "recommended" }}
							checked={enableCheckpointsSetting}
							description="Enables extension to save checkpoints of workspace throughout the task. Uses git under the hood."
							label="Enable Checkpoints"
							onChange={(checked) => updateSetting("enableCheckpointsSetting", checked)}
						/>

						<FeatureItem
							badge={{ text: "Recommended", variant: "recommended" }}
							checked={focusChainSettings?.enabled || false}
							description="Enables enhanced task progress tracking and automatic focus chain list management."
							label="Enable Focus Chain"
							onChange={(checked) =>
								updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
							}
						/>

						{focusChainSettings?.enabled && (
							<div className="mt-2 ml-4 pt-2 border-t border-vscode-widget-border">
								<label
									className="block text-xs font-medium text-(--vscode-foreground) mb-2"
									htmlFor="focus-chain-remind-interval">
									Reminder Interval
								</label>
								<VSCodeTextField
									className="w-16 text-xs"
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
								<p className="text-[10px] mt-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
									Messages between reminders (1-100)
								</p>
							</div>
						)}
					</FeatureGroup>

					{/* CONTEXT & MEMORY OPTIMIZATION */}
					<FeatureGroup
						description="Controls how context is condensed and maintained over time."
						isGridItem
						title="Context & Memory Optimization">
						<FeatureItem
							checked={useAutoCondense}
							description="Enables advanced context management using LLM-based condensing for next-gen models."
							label="Enable Auto Compact"
							onChange={(checked) => updateSetting("useAutoCondense", checked)}
						/>
					</FeatureGroup>

					{/* OUTPUT & DISPLAY */}
					<FeatureGroup
						description="Defines how responses and tool outputs are rendered."
						isGridItem
						title="Output & Display">
						<div>
							<label
								className="block text-xs font-medium text-(--vscode-foreground) mb-2"
								htmlFor="mcp-display-mode-dropdown">
								MCP Display Mode
							</label>
							<McpDisplayModeDropdown
								className="w-full"
								id="mcp-display-mode-dropdown"
								onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
								value={mcpDisplayMode}
							/>
						</div>
					</FeatureGroup>

					{/* TOOLING & AGENT CAPABILITIES */}
					<FeatureGroup
						description="Controls what tools the agent can invoke and how it invokes them."
						isGridItem
						title="Tooling & Agent Capabilities">
						<FeatureItem
							badge={{ text: "Recommended", variant: "recommended" }}
							checked={nativeToolCallSetting}
							description="Uses the model's native tool calling API instead of XML-based tool parsing."
							label="Enable Native Tool Call"
							onChange={(enabled) => updateSetting("nativeToolCallEnabled", enabled)}
						/>

						<FeatureItem
							badge={{ text: "Recommended", variant: "recommended" }}
							checked={enableParallelToolCalling}
							description="Allows models to call multiple tools in a single response. Auto-enabled for GPT-5 models."
							label="Enable Parallel Tool Calling"
							onChange={(enabled) => updateSetting("enableParallelToolCalling", enabled)}
						/>

						{clineWebToolsEnabled?.featureFlag && (
							<FeatureItem
								badge={{ text: "Recommended", variant: "recommended" }}
								checked={clineWebToolsEnabled?.user}
								description="Enables websearch and webfetch tools while using the Cline provider."
								label="Enable Cline Web Tools"
								onChange={(checked) => updateSetting("clineWebToolsEnabled", checked)}
							/>
						)}
					</FeatureGroup>

					{/* WORKSPACE & FILE OPERATIONS */}
					<FeatureGroup
						description="Defines how Cline interacts with files and project structure."
						isGridItem
						title="Workspace & File Operations">
						<FeatureItem
							badge={{ text: "Experimental", variant: "experimental" }}
							checked={backgroundEditEnabled}
							description="Edit files without opening the diff view in editor."
							label="Enable Background Edit"
							onChange={(checked) => updateSetting("backgroundEditEnabled", checked)}
						/>

						{worktreesEnabled?.featureFlag && (
							<FeatureItem
								checked={worktreesEnabled?.user}
								description="Enables git worktree management for running parallel Cline tasks."
								label="Enable Worktrees"
								onChange={(checked) => updateSetting("worktreesEnabled", checked)}
							/>
						)}
					</FeatureGroup>

					{/* EXTENSIBILITY & AUTOMATION */}
					<FeatureGroup
						description="Enables advanced customization, reuse, and automation behaviors."
						isGridItem
						title="Extensibility & Automation">
						<FeatureItem
							badge={{ text: "Recommended", variant: "recommended" }}
							checked={skillsEnabled}
							description="Enables reusable, on-demand agent instructions from .cline/skills/ directories."
							label="Enable Skills"
							onChange={(checked) => updateSetting("skillsEnabled", checked)}
						/>

						{/* Subagents - Only show on macOS and Linux */}
						{isMacOSOrLinux() && PLATFORM_CONFIG.type === PlatformType.VSCODE && (
							<div>
								{!isClineCliInstalled && (
									<div
										className="mb-2 p-2 rounded text-[11px]"
										style={{
											backgroundColor:
												"color-mix(in srgb, var(--vscode-inputValidation-warningBackground) 20%, transparent)",
											border: "1px solid var(--vscode-inputValidation-warningBorder)",
											color: "var(--vscode-inputValidation-warningForeground)",
										}}>
										<p className="mb-1 flex items-start">
											<span
												className="codicon codicon-warning mr-1"
												style={{ fontSize: "10px", marginTop: "1px", flexShrink: 0 }}></span>
											<span>
												Cline CLI required. Install with:
												<code
													className="mx-0.5 px-0.5"
													style={{
														backgroundColor: "var(--vscode-editor-background)",
														fontSize: "10px",
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
												transform: "scale(0.75)",
												transformOrigin: "left center",
												marginTop: "2px",
											}}>
											Install Now
										</VSCodeButton>
									</div>
								)}

								<FeatureItem
									badge={{ text: "Recommended", variant: "recommended" }}
									checked={subagentsEnabled}
									description="Spawn subprocesses to handle focused tasks like exploring large codebases."
									disabled={!isClineCliInstalled}
									label="Enable Subagents"
									onChange={(checked) => updateSetting("subagentsEnabled", checked)}
								/>

								{subagentsEnabled && (
									<div className="mt-2">
										<SubagentOutputLineLimitSlider />
									</div>
								)}
							</div>
						)}
					</FeatureGroup>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
