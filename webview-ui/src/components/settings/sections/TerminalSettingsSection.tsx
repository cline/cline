import React, { useState, useEffect } from "react"
import { VSCodeTextField, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import TerminalOutputLineLimitSlider from "../TerminalOutputLineLimitSlider"
import { StateServiceClient } from "../../../services/grpc-client"
import { Int64, Int64Request, StringRequest } from "@shared/proto/common"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface TerminalSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

export const TerminalSettingsSection: React.FC<TerminalSettingsSectionProps> = ({ renderSectionHeader }) => {
	const { shellIntegrationTimeout, terminalReuseEnabled, defaultTerminalProfile, availableTerminalProfiles } =
		useExtensionState()

	const [inputValue, setInputValue] = useState((shellIntegrationTimeout / 1000).toString())
	const [inputError, setInputError] = useState<string | null>(null)

	const handleTimeoutChange = (event: Event) => {
		const target = event.target as HTMLInputElement
		const value = target.value

		setInputValue(value)

		const seconds = parseFloat(value)
		if (isNaN(seconds) || seconds <= 0) {
			setInputError("Please enter a positive number")
			return
		}

		setInputError(null)
		const timeout = Math.round(seconds * 1000)

		StateServiceClient.updateTerminalConnectionTimeout({
			value: timeout,
		} as Int64Request)
			.then((response: Int64) => {
				// Backend calls postStateToWebview(), so state will update via subscription
				// Just sync the input value with the confirmed backend value
				setInputValue((response.value / 1000).toString())
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
		const checked = target.checked
		updateSetting("terminalReuseEnabled", checked)
	}

	// Use any to avoid type conflicts between Event and FormEvent
	const handleDefaultTerminalProfileChange = (event: any) => {
		const target = event.target as HTMLSelectElement
		const profileId = target.value

		// Save immediately - the backend will call postStateToWebview() to update our state
		StateServiceClient.updateDefaultTerminalProfile({
			value: profileId || "default",
		} as StringRequest).catch((error) => {
			console.error("Failed to update default terminal profile:", error)
		})
	}

	const profilesToShow = availableTerminalProfiles

	return (
		<div>
			{renderSectionHeader("terminal")}
			<Section>
				<div id="terminal-settings-section" className="mb-5">
					<div className="mb-4">
						<label htmlFor="default-terminal-profile" className="font-medium block mb-1">
							Default Terminal Profile
						</label>
						<VSCodeDropdown
							id="default-terminal-profile"
							value={defaultTerminalProfile || "default"}
							onChange={handleDefaultTerminalProfileChange}
							className="w-full">
							{profilesToShow.map((profile) => (
								<VSCodeOption key={profile.id} value={profile.id} title={profile.description}>
									{profile.name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
						<p className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
							Select the default terminal Cline will use. 'Default' uses your VSCode global setting.
						</p>
					</div>

					<div className="mb-4">
						<div className="mb-2">
							<label className="font-medium block mb-1">Shell integration timeout (seconds)</label>
							<div className="flex items-center">
								<VSCodeTextField
									className="w-full"
									value={inputValue}
									placeholder="Enter timeout in seconds"
									onChange={(event) => handleTimeoutChange(event as Event)}
									onBlur={handleInputBlur}
								/>
							</div>
							{inputError && <div className="text-[var(--vscode-errorForeground)] text-xs mt-1">{inputError}</div>}
						</div>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							Set how long Cline waits for shell integration to activate before executing commands. Increase this
							value if you experience terminal connection timeouts.
						</p>
					</div>

					<div className="mb-4">
						<div className="flex items-center mb-2">
							<VSCodeCheckbox
								checked={terminalReuseEnabled ?? true}
								onChange={(event) => handleTerminalReuseChange(event as Event)}>
								Enable aggressive terminal reuse
							</VSCodeCheckbox>
						</div>
						<p className="text-xs text-[var(--vscode-descriptionForeground)]">
							When enabled, Cline will reuse existing terminal windows that aren't in the current working directory.
							Disable this if you experience issues with task lockout after a terminal command.
						</p>
					</div>
					<TerminalOutputLineLimitSlider />
					<div className="mt-5 p-3 bg-[var(--vscode-textBlockQuote-background)] rounded border border-[var(--vscode-textBlockQuote-border)]">
						<p className="text-[13px] m-0">
							<strong>Having terminal issues?</strong> Check our{" "}
							<a
								href="https://docs.cline.bot/troubleshooting/terminal-quick-fixes"
								className="text-[var(--vscode-textLink-foreground)] underline hover:no-underline"
								target="_blank"
								rel="noopener noreferrer">
								Terminal Quick Fixes
							</a>{" "}
							or the{" "}
							<a
								href="https://docs.cline.bot/troubleshooting/terminal-integration-guide"
								className="text-[var(--vscode-textLink-foreground)] underline hover:no-underline"
								target="_blank"
								rel="noopener noreferrer">
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
