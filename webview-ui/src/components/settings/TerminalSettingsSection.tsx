import React, { useState, useEffect } from "react"
import { VSCodeTextField, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import TerminalOutputLineLimitSlider from "./TerminalOutputLineLimitSlider"
import { StateServiceClient } from "../../services/grpc-client"
import { Int64, Int64Request } from "@shared/proto/common"

export const TerminalSettingsSection: React.FC = () => {
	const {
		shellIntegrationTimeout,
		setShellIntegrationTimeout,
		terminalReuseEnabled,
		setTerminalReuseEnabled,
		defaultTerminalProfile,
		setDefaultTerminalProfile,
		availableTerminalProfiles,
		platform,
	} = useExtensionState()

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

		setShellIntegrationTimeout(timeout)

		StateServiceClient.updateTerminalConnectionTimeout({
			value: timeout,
		} as Int64Request)
			.then((response: Int64) => {
				setShellIntegrationTimeout(response.value)
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
		setTerminalReuseEnabled(checked)
		StateServiceClient.updateTerminalReuseEnabled({ value: checked } as any).catch((error) => {
			console.error("Failed to update terminal reuse enabled:", error)
		})
	}

	// Use any to avoid type conflicts between Event and FormEvent
	const handleDefaultTerminalProfileChange = (event: any) => {
		const target = event.target as HTMLSelectElement
		const profileId = target.value
		// Only update the local state, let the Save button handle the backend update
		setDefaultTerminalProfile(profileId)
	}

	const profilesToShow = availableTerminalProfiles

	return (
		<div id="terminal-settings-section" style={{ marginBottom: 20 }}>
			<div style={{ marginBottom: 15 }}>
				<label htmlFor="default-terminal-profile" style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
					Default Terminal Profile
				</label>
				<VSCodeDropdown
					id="default-terminal-profile"
					value={defaultTerminalProfile || "default"}
					onChange={handleDefaultTerminalProfileChange}
					style={{ width: "100%" }}>
					{profilesToShow.map((profile) => (
						<VSCodeOption key={profile.id} value={profile.id} title={profile.description}>
							{profile.name}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "5px 0 0 0" }}>
					Select the default terminal Cline will use. 'Default' uses your VSCode global setting.
				</p>
			</div>

			<div style={{ marginBottom: 15 }}>
				<div style={{ marginBottom: 8 }}>
					<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
						Shell integration timeout (seconds)
					</label>
					<div style={{ display: "flex", alignItems: "center" }}>
						<VSCodeTextField
							style={{ width: "100%" }}
							value={inputValue}
							placeholder="Enter timeout in seconds"
							onChange={(event) => handleTimeoutChange(event as Event)}
							onBlur={handleInputBlur}
						/>
					</div>
					{inputError && (
						<div style={{ color: "var(--vscode-errorForeground)", fontSize: "12px", marginTop: 5 }}>{inputError}</div>
					)}
				</div>
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: 0 }}>
					Set how long Cline waits for shell integration to activate before executing commands. Increase this value if
					you experience terminal connection timeouts.
				</p>
			</div>

			<div style={{ marginBottom: 15 }}>
				<div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
					<VSCodeCheckbox
						checked={terminalReuseEnabled ?? true}
						onChange={(event) => handleTerminalReuseChange(event as Event)}>
						Enable aggressive terminal reuse
					</VSCodeCheckbox>
				</div>
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: 0 }}>
					When enabled, Cline will reuse existing terminal windows that aren't in the current working directory. Disable
					this if you experience issues with task lockout after a terminal command.
				</p>
			</div>
			<TerminalOutputLineLimitSlider />
		</div>
	)
}

export default TerminalSettingsSection
