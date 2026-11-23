import { UpdateTerminalConnectionTimeoutResponse } from "@shared/proto/index.cline"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useState } from "react"
import { PlatformType } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { usePlatform } from "@/context/PlatformContext"
import { StateServiceClient } from "../../../services/grpc-client"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface TerminalSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const TerminalSettingsSection: React.FC<TerminalSettingsSectionProps> = ({ renderSectionHeader }) => {
	const {
		shellIntegrationTimeout,
		terminalReuseEnabled,
		defaultTerminalProfile,
		availableTerminalProfiles,
		vscodeTerminalExecutionMode,
	} = useExtensionState()
	const platformConfig = usePlatform()
	const isVsCodePlatform = platformConfig.type === PlatformType.VSCODE
	const executionMode = vscodeTerminalExecutionMode ?? "vscodeTerminal"
	const isBackgroundExec = executionMode === "backgroundExec"

	const [inputValue, setInputValue] = useState((shellIntegrationTimeout / 1000).toString())
	const [inputError, setInputError] = useState<string | null>(null)

	const handleTimeoutChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const value = target.value
		setInputValue(value)

		const seconds = Number.parseFloat(value)
		if (Number.isNaN(seconds) || seconds <= 0) {
			setInputError("Please enter a positive number")
			return
		}

		setInputError(null)
		const timeoutMs = Math.round(seconds * 1000)

		StateServiceClient.updateTerminalConnectionTimeout({ timeoutMs })
			.then((response: UpdateTerminalConnectionTimeoutResponse) => {
				if (response.timeoutMs !== undefined) {
					setInputValue((response.timeoutMs / 1000).toString())
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

	const handleTerminalReuseChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		updateSetting("terminalReuseEnabled", target.checked)
	}

	const handleExecutionModeChange = (event: Event) => {
		const target = event.target as HTMLSelectElement
		const value = target.value === "backgroundExec" ? "backgroundExec" : "vscodeTerminal"
		updateSetting("vscodeTerminalExecutionMode", value)
	}

	const handleDefaultTerminalProfileChange = (event: any) => {
		const target = event.target as HTMLSelectElement
		updateSetting("defaultTerminalProfile", target.value || "default")
	}

	return (
		<div>
			{renderSectionHeader("terminal")}
			<Section id="terminal-settings-section">
				{/* Execution & Profile Card */}
				<div>
					<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
						Execution & Profile
					</div>
					<div className="rounded-xl bg-[#151618] border border-white/[0.08] px-4 divide-y divide-white/[0.06]">
						{isVsCodePlatform && (
							<div className="py-3.5 flex flex-col gap-1.5">
								<label className="text-[13.5px] font-medium text-[#eceef0]" htmlFor="terminal-execution-mode">
									Terminal Execution Mode
								</label>
								<VSCodeDropdown
									className="w-full"
									id="terminal-execution-mode"
									onChange={(event) => handleExecutionModeChange(event as Event)}
									value={executionMode}>
									<VSCodeOption value="vscodeTerminal">VS Code Terminal</VSCodeOption>
									<VSCodeOption value="backgroundExec">Background Exec</VSCodeOption>
								</VSCodeDropdown>
								<p className="text-[12px] text-[#858b94] m-0">
									Run commands inside the integrated VS Code terminal or silently in a background process.
								</p>
							</div>
						)}

						<div className="py-3.5 flex flex-col gap-1.5">
							<label className="text-[13.5px] font-medium text-[#eceef0]" htmlFor="default-terminal-profile">
								Default Terminal Profile
							</label>
							<VSCodeDropdown
								className="w-full"
								id="default-terminal-profile"
								onChange={handleDefaultTerminalProfileChange}
								value={defaultTerminalProfile || "default"}>
								{availableTerminalProfiles.map((profile) => (
									<VSCodeOption key={profile.id} title={profile.description} value={profile.id}>
										{profile.name}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
							<p className="text-[12px] text-[#858b94] m-0">
								Select the shell profile used by Cline. "Default" inherits your VS Code global setting.
							</p>
						</div>
					</div>
				</div>

				{/* Shell Integration Card */}
				{isVsCodePlatform && !isBackgroundExec && (
					<div>
						<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
							Shell Integration
						</div>
						<div className="rounded-xl bg-[#151618] border border-white/[0.08] px-4 divide-y divide-white/[0.06]">
							<div className="py-3.5 flex flex-col gap-1.5">
								<label className="text-[13.5px] font-medium text-[#eceef0]">
									Shell integration timeout (seconds)
								</label>
								<VSCodeTextField
									className="w-full"
									onBlur={handleInputBlur}
									onChange={(event) => handleTimeoutChange(event as Event)}
									placeholder="Enter timeout in seconds"
									value={inputValue}
								/>
								{inputError && <div className="text-error text-xs">{inputError}</div>}
								<p className="text-[12px] text-[#858b94] m-0">
									Wait time for shell integration activation before command execution.
								</p>
							</div>

							<div className="py-3.5 flex flex-col gap-1">
								<VSCodeCheckbox
									checked={terminalReuseEnabled ?? true}
									onChange={(event) => handleTerminalReuseChange(event as Event)}>
									<span className="text-[13.5px] font-medium text-[#eceef0]">
										Enable aggressive terminal reuse
									</span>
								</VSCodeCheckbox>
								<p className="text-[12px] text-[#858b94] m-0">
									Reuse existing terminal instances even when their working directory differs.
								</p>
							</div>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}

export default TerminalSettingsSection
