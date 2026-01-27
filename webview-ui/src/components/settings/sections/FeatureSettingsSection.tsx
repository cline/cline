import { McpDisplayMode } from "@shared/McpDisplayMode"
import { EmptyRequest } from "@shared/proto/index.cline"
import { OpenaiReasoningEffort } from "@shared/storage/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import styled from "styled-components"
import McpDisplayModeDropdown from "@/components/mcp/chat-display/McpDisplayModeDropdown"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { isMacOSOrLinux } from "@/utils/platformUtils"
import Section from "../Section"
import SubagentOutputLineLimitSlider from "../SubagentOutputLineLimitSlider"
import { updateSetting } from "../utils/settingsHandlers"

// Styled components for the new clean design
const SectionHeader = styled.div`
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.05em;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 12px;
	margin-top: 24px;
	&:first-child {
		margin-top: 0;
	}
`

const FeatureCard = styled.div`
	border: 1px solid var(--vscode-widget-border);
	border-radius: 8px;
	margin-bottom: 16px;
	overflow: hidden;
`

const FeatureRow = styled.div<{ $isLast?: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 14px 16px;
	border-bottom: ${(props) => (props.$isLast ? "none" : "1px solid var(--vscode-widget-border)")};
`

const FeatureInfo = styled.div`
	flex: 1;
	margin-right: 16px;
`

const FeatureTitle = styled.div`
	font-size: 13px;
	font-weight: 500;
	color: var(--vscode-foreground);
	margin-bottom: 2px;
`

const FeatureDescription = styled.div`
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const Toggle = styled.label`
	position: relative;
	display: inline-block;
	width: 44px;
	height: 24px;
	flex-shrink: 0;
`

const ToggleInput = styled.input`
	opacity: 0;
	width: 0;
	height: 0;

	&:checked + span {
		background-color: var(--vscode-button-background);
	}

	&:checked + span:before {
		transform: translateX(20px);
	}

	&:disabled + span {
		opacity: 0.5;
		cursor: not-allowed;
	}
`

const ToggleSlider = styled.span`
	position: absolute;
	cursor: pointer;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background-color: #3a3a3a;
	transition: 0.2s;
	border-radius: 24px;

	&:before {
		position: absolute;
		content: "";
		height: 18px;
		width: 18px;
		left: 3px;
		bottom: 3px;
		background-color: #999;
		transition: 0.2s;
		border-radius: 50%;
	}
`

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

interface ToggleSwitchProps {
	checked: boolean
	onChange: (checked: boolean) => void
	disabled?: boolean
}

const ToggleSwitch = ({ checked, onChange, disabled }: ToggleSwitchProps) => (
	<Toggle>
		<ToggleInput checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} type="checkbox" />
		<ToggleSlider />
	</Toggle>
)

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
		skillsEnabled,
		mcpDisplayMode,
		openaiReasoningEffort,
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
		const pollInterval = setInterval(checkInstallation, 1500)
		return () => clearInterval(pollInterval)
	}, [])

	return (
		<div>
			{renderSectionHeader("features")}
			<Section>
				<div style={{ marginBottom: 20 }}>
					{/* TOOL CALLING */}
					<SectionHeader>TOOL CALLING</SectionHeader>
					<FeatureCard>
						<FeatureRow>
							<FeatureInfo>
								<FeatureTitle>Native Tool Call</FeatureTitle>
								<FeatureDescription>Use native function calling when available</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={nativeToolCallSetting ?? false}
								onChange={(checked) => updateSetting("nativeToolCallEnabled", checked)}
							/>
						</FeatureRow>
						<FeatureRow $isLast>
							<FeatureInfo>
								<FeatureTitle>Parallel Tool Calling</FeatureTitle>
								<FeatureDescription>Execute multiple tool calls simultaneously</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={enableParallelToolCalling ?? false}
								onChange={(checked) => updateSetting("enableParallelToolCalling", checked)}
							/>
						</FeatureRow>
					</FeatureCard>

					{/* AGENT BEHAVIOR */}
					<SectionHeader>AGENT BEHAVIOR</SectionHeader>
					<FeatureCard>
						<FeatureRow>
							<FeatureInfo>
								<FeatureTitle>Focus Chain</FeatureTitle>
								<FeatureDescription>Maintain context focus across interactions</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={focusChainSettings?.enabled || false}
								onChange={(checked) =>
									updateSetting("focusChainSettings", { ...focusChainSettings, enabled: checked })
								}
							/>
						</FeatureRow>
						{focusChainSettings?.enabled && (
							<FeatureRow>
								<FeatureInfo>
									<FeatureTitle style={{ fontSize: 12 }}>Focus Chain Reminder Interval</FeatureTitle>
									<FeatureDescription>
										Interval (in messages) to remind about focus chain checklist (1-100)
									</FeatureDescription>
								</FeatureInfo>
								<input
									onChange={(e) => {
										const value = parseInt(e.target.value, 10)
										if (!Number.isNaN(value) && value >= 1 && value <= 100) {
											updateSetting("focusChainSettings", {
												...focusChainSettings,
												remindClineInterval: value,
											})
										}
									}}
									style={{
										width: 60,
										padding: "8px 12px",
										borderRadius: 6,
										border: "1px solid var(--vscode-widget-border)",
										backgroundColor: "var(--vscode-input-background)",
										color: "var(--vscode-input-foreground)",
										fontSize: 14,
										textAlign: "center",
									}}
									type="text"
									value={focusChainSettings?.remindClineInterval || 6}
								/>
							</FeatureRow>
						)}
						<FeatureRow>
							<FeatureInfo>
								<FeatureTitle>Auto Compact</FeatureTitle>
								<FeatureDescription>Automatically compress conversation history</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={useAutoCondense ?? false}
								onChange={(checked) => updateSetting("useAutoCondense", checked)}
							/>
						</FeatureRow>
						{isMacOSOrLinux() && PLATFORM_CONFIG.type === PlatformType.VSCODE && (
							<>
								<FeatureRow>
									<FeatureInfo>
										<FeatureTitle>Subagents</FeatureTitle>
										<FeatureDescription>
											Delegate tasks to specialized sub-agents (experimental)
											{!isClineCliInstalled && (
												<span
													style={{
														display: "block",
														marginTop: 4,
														color: "var(--vscode-inputValidation-warningForeground)",
													}}>
													Requires Cline CLI: npm install -g cline
												</span>
											)}
										</FeatureDescription>
									</FeatureInfo>
									<ToggleSwitch
										checked={subagentsEnabled ?? false}
										disabled={!isClineCliInstalled}
										onChange={(checked) => updateSetting("subagentsEnabled", checked)}
									/>
								</FeatureRow>
								{subagentsEnabled && (
									<FeatureRow>
										<div style={{ width: "100%" }}>
											<SubagentOutputLineLimitSlider />
										</div>
									</FeatureRow>
								)}
							</>
						)}
						<FeatureRow>
							<FeatureInfo>
								<FeatureTitle>Skills</FeatureTitle>
								<FeatureDescription>Custom skills with reusable prompts and instructions</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={skillsEnabled ?? false}
								onChange={(checked) => updateSetting("skillsEnabled", checked)}
							/>
						</FeatureRow>
						<FeatureRow $isLast>
							<FeatureInfo>
								<FeatureTitle style={{ color: "var(--vscode-inputValidation-warningForeground)" }}>
									YOLO Mode
								</FeatureTitle>
								<FeatureDescription>
									Execute tasks without confirmation prompts. Use with caution.
								</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={yoloModeToggled ?? false}
								disabled={remoteConfigSettings?.yoloModeToggled !== undefined}
								onChange={(checked) => updateSetting("yoloModeToggled", checked)}
							/>
						</FeatureRow>
					</FeatureCard>

					{/* EDITING & AUTOMATION */}
					<SectionHeader>EDITING & AUTOMATION</SectionHeader>
					<FeatureCard>
						<FeatureRow>
							<FeatureInfo>
								<FeatureTitle>Background Edit</FeatureTitle>
								<FeatureDescription>Edit files without opening diff view</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={backgroundEditEnabled ?? false}
								onChange={(checked) => updateSetting("backgroundEditEnabled", checked)}
							/>
						</FeatureRow>
						{clineWebToolsEnabled?.featureFlag && (
							<FeatureRow>
								<FeatureInfo>
									<FeatureTitle>Cline Web Tools</FeatureTitle>
									<FeatureDescription>Access web browsing and search capabilities</FeatureDescription>
								</FeatureInfo>
								<ToggleSwitch
									checked={clineWebToolsEnabled?.user || false}
									onChange={(checked) => updateSetting("clineWebToolsEnabled", checked)}
								/>
							</FeatureRow>
						)}
						<FeatureRow>
							<FeatureInfo>
								<FeatureTitle>Checkpoints</FeatureTitle>
								<FeatureDescription>Save progress at key points for easy rollback</FeatureDescription>
							</FeatureInfo>
							<ToggleSwitch
								checked={enableCheckpointsSetting ?? false}
								onChange={(checked) => updateSetting("enableCheckpointsSetting", checked)}
							/>
						</FeatureRow>
						{worktreesEnabled?.featureFlag && (
							<FeatureRow $isLast>
								<FeatureInfo>
									<FeatureTitle>Worktrees</FeatureTitle>
									<FeatureDescription>Git worktree management for parallel tasks</FeatureDescription>
								</FeatureInfo>
								<ToggleSwitch
									checked={worktreesEnabled?.user || false}
									onChange={(checked) => updateSetting("worktreesEnabled", checked)}
								/>
							</FeatureRow>
						)}
					</FeatureCard>

					{/* ADVANCED */}
					<SectionHeader>ADVANCED</SectionHeader>
					<FeatureCard>
						<FeatureRow>
							<FeatureInfo>
								<FeatureTitle>OpenAI Reasoning Effort</FeatureTitle>
								<FeatureDescription>Adjust reasoning depth for OpenAI models</FeatureDescription>
							</FeatureInfo>
							<VSCodeDropdown
								currentValue={openaiReasoningEffort || "medium"}
								onChange={(e: any) => {
									const newValue = e.target.currentValue as OpenaiReasoningEffort
									handleReasoningEffortChange(newValue)
								}}
								style={{ width: 100 }}>
								<VSCodeOption value="minimal">Minimal</VSCodeOption>
								<VSCodeOption value="low">Low</VSCodeOption>
								<VSCodeOption value="medium">Medium</VSCodeOption>
								<VSCodeOption value="high">High</VSCodeOption>
							</VSCodeDropdown>
						</FeatureRow>
						<FeatureRow $isLast>
							<FeatureInfo>
								<FeatureTitle>MCP Display Mode</FeatureTitle>
								<FeatureDescription>Configure Model Context Protocol display options</FeatureDescription>
							</FeatureInfo>
							<McpDisplayModeDropdown
								onChange={(newMode: McpDisplayMode) => updateSetting("mcpDisplayMode", newMode)}
								style={{ width: 120 }}
								value={mcpDisplayMode}
							/>
						</FeatureRow>
					</FeatureCard>
				</div>
			</Section>
		</div>
	)
}

export default memo(FeatureSettingsSection)
