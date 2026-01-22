import { UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/index.cline"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { StateServiceClient } from "../../../services/grpc-client"
import { FeatureGroup } from "../FeatureGroup"
import { FeatureItem } from "../FeatureItem"
import Section from "../Section"
import TerminalOutputLineLimitSlider from "../TerminalOutputLineLimitSlider"
import { updateSetting } from "../utils/settingsHandlers"

interface TerminalSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

export const TerminalSettingsSection: React.FC<TerminalSettingsSectionProps> = ({ renderSectionHeader }) => {
	const {
		shellIntegrationTimeout,
		terminalReuseEnabled,
		defaultTerminalProfile,
		availableTerminalProfiles,
		vscodeTerminalExecutionMode,
	} = useExtensionState()
	const platformConfig = usePlatform()
	const isVsCodePlatform = platformConfig.type === PlatformType.VSCODE

	const [inputValue, setInputValue] = useState((shellIntegrationTimeout / 1000).toString())
	const [inputError, setInputError] = useState<string | null>(null)

	const handleTimeoutChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const value = target.value

		setInputValue(value)

		const seconds = parseFloat(value)
		if (Number.isNaN(seconds) || seconds <= 0) {
			setInputError("Please enter a positive number")
			return
		}

		setInputError(null)
		const timeoutMs = Math.round(seconds * 1000)

		StateServiceClient.updateTerminalConnectionTimeout({ timeoutMs })
			.then((response: UpdateTerminalConnectionTimeoutResponse) => {
				const timeoutMs = response.timeoutMs
				if (timeoutMs !== undefined) {
					setInputValue((timeoutMs / 1000).toString())
				}
			})
			.catch((error) => {
				console.error("Failed to update terminal connection timeout:", error)
			})
	}

	const handleInputBlur = () => {
		if (inputError) {
			setInputValue((shellIntegrationTimeout / 1000).toString())
			setInputError(null)
		}
	}

	const profilesToShow = availableTerminalProfiles

	return (
		<div>
			{renderSectionHeader("terminal")}
			<Section>
				<div className="grid grid-cols-1 gap-4">
					{/* TERMINAL CONFIGURATION */}
					<FeatureGroup isGridItem={false} title="Terminal Configuration">
						{/* Default Terminal Profile */}
						<div className="flex items-center justify-between gap-3 px-2">
							<label
								className="text-sm font-medium"
								htmlFor="default-terminal-profile"
								style={{ color: "var(--vscode-foreground)" }}>
								Default Terminal Profile
							</label>
							<div className="pr-2">
								<Select
									onValueChange={(profileId) => updateSetting("defaultTerminalProfile", profileId || "default")}
									value={defaultTerminalProfile || "default"}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{profilesToShow.map((profile) => (
											<SelectItem key={profile.id} value={profile.id}>
												{profile.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>

						{/* Shell Integration Timeout */}
						<div className="flex items-center justify-between gap-3 px-2">
							<label className="text-sm font-medium" style={{ color: "var(--vscode-foreground)" }}>
								Shell integration timeout (seconds)
							</label>
							<div className="pr-2">
								<VSCodeTextField
									className="w-20 text-xs"
									onBlur={handleInputBlur}
									onChange={(event) => handleTimeoutChange(event as Event)}
									placeholder="Seconds"
									value={inputValue}
								/>
							</div>
						</div>
						{inputError && (
							<div className="text-xs px-2" style={{ color: "var(--vscode-errorForeground)" }}>
								{inputError}
							</div>
						)}

						{/* Enable Aggressive Terminal Reuse */}
						<FeatureItem
							checked={terminalReuseEnabled ?? true}
							description="When enabled, Cline will reuse existing terminal windows that aren't in the current working directory. Disable this if you experience issues with task lockout after a terminal command."
							label="Enable aggressive terminal reuse"
							onChange={(checked) => updateSetting("terminalReuseEnabled", checked)}
						/>

						{/* Terminal Execution Mode */}
						{isVsCodePlatform && (
							<div className="flex items-center justify-between gap-3 px-2">
								<label
									className="text-sm font-medium"
									htmlFor="terminal-execution-mode"
									style={{ color: "var(--vscode-foreground)" }}>
									Terminal Execution Mode
								</label>
								<div className="pr-2">
									<Select
										onValueChange={(value) =>
											updateSetting(
												"vscodeTerminalExecutionMode",
												value as "vscodeTerminal" | "backgroundExec",
											)
										}
										value={vscodeTerminalExecutionMode ?? "vscodeTerminal"}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="vscodeTerminal">VS Code Terminal</SelectItem>
											<SelectItem value="backgroundExec">Background Exec</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
						)}

						{/* Terminal Output Line Limit */}
						<div className="px-2">
							<TerminalOutputLineLimitSlider />
						</div>
					</FeatureGroup>

					{/* HELP & DOCUMENTATION */}
					<div className="p-3 rounded-md" style={{ backgroundColor: "rgba(255, 255, 255, 0.03)" }}>
						<p className="text-xs m-0" style={{ color: "var(--vscode-foreground)" }}>
							<strong>Having terminal issues?</strong> Check our{" "}
							<a
								className="underline hover:no-underline"
								href="https://docs.cline.bot/troubleshooting/terminal-quick-fixes"
								rel="noopener noreferrer"
								style={{ color: "var(--vscode-textLink-foreground)" }}
								target="_blank">
								Terminal Quick Fixes
							</a>{" "}
							or the{" "}
							<a
								className="underline hover:no-underline"
								href="https://docs.cline.bot/troubleshooting/terminal-integration-guide"
								rel="noopener noreferrer"
								style={{ color: "var(--vscode-textLink-foreground)" }}
								target="_blank">
								Complete Troubleshooting Guide
							</a>
							.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default TerminalSettingsSection
