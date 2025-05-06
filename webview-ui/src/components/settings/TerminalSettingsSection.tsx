import React, { useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"

export const TerminalSettingsSection: React.FC = () => {
	const { shellIntegrationTimeout, setShellIntegrationTimeout } = useExtensionState()
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
		const timeout = Math.round(seconds * 1000) // Convert to milliseconds

		// Update local state
		setShellIntegrationTimeout(timeout)

		// Send to extension
		vscode.postMessage({
			type: "updateTerminalConnectionTimeout",
			shellIntegrationTimeout: timeout,
		})
	}

	const handleInputBlur = () => {
		// If there was an error, reset the input to the current valid value
		if (inputError) {
			setInputValue((shellIntegrationTimeout / 1000).toString())
			setInputError(null)
		}
	}

	return (
		<div
			id="terminal-settings-section"
			style={{ marginBottom: 20, borderTop: "1px solid var(--vscode-panel-border)", paddingTop: 15 }}>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 10px 0", fontSize: "14px" }}>Terminal Settings</h3>
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
		</div>
	)
}

export default TerminalSettingsSection
