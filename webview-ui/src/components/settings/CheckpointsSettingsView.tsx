import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeLink, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"
import type { CheckpointSettings } from "../../../../src/shared/WebviewMessage"

const fileSizeOptions = [
	{ value: "5", text: "5MB" },
	{ value: "10", text: "10MB" },
	{ value: "25", text: "25MB" },
	{ value: "50", text: "50MB" },
	{ value: "100", text: "100MB" },
]

const CheckpointsSettingsView = () => {
	const [settings, setSettings] = useState<CheckpointSettings>({
		fileSizeThresholdMB: 5,
		enableCheckpoints: true,
	})

	useEffect(() => {
		// Get initial settings
		vscode.postMessage({
			type: "getCheckpointSettings",
		})
	}, [])

	useEffect(() => {
		const messageHandler = (event: MessageEvent) => {
			const message = event.data
			switch (message.type) {
				case "checkpointSettings":
					setSettings(message.checkpointSettings)
					break
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [])

	const handleFileSizeChange = (e: any) => {
		const select = e.target as HTMLSelectElement
		const newSettings = {
			...settings,
			fileSizeThresholdMB: parseInt(select.value),
		}
		setSettings(newSettings)
		vscode.postMessage({
			type: "updateCheckpointSettings",
			checkpointSettings: newSettings,
		})
	}

	const handleEnableChange = (e: any) => {
		const checkbox = e.target as HTMLInputElement
		const newSettings = {
			...settings,
			enableCheckpoints: checkbox.checked,
		}
		setSettings(newSettings)
		vscode.postMessage({
			type: "updateCheckpointSettings",
			checkpointSettings: newSettings,
		})
	}

	const handleDeleteCheckpoints = () => {
		vscode.postMessage({
			type: "confirmDeleteAllCheckpoints",
		})
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>Enable Checkpoints</div>
				<VSCodeCheckbox checked={settings.enableCheckpoints} onChange={handleEnableChange}>
					Enable checkpoints
				</VSCodeCheckbox>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Automatically create checkpoints when Cline makes changes to your files
				</p>
			</div>

			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>File Size Threshold</div>
				<VSCodeDropdown value={`${settings.fileSizeThresholdMB}`} onChange={handleFileSizeChange}>
					{fileSizeOptions.map((option) => (
						<VSCodeOption key={option.value} value={option.value}>
							{option.text}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Exclude files larger than this size from checkpoint creation globally
				</p>
			</div>

			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>Checkpoints File Exclusions</div>
				<VSCodeLink onClick={() => vscode.postMessage({ type: "openCheckpointsIgnore" })}>
					Edit .checkpointsignore
				</VSCodeLink>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Configure which files and directories to exclude from checkpoint creation globally
				</p>
			</div>

			<div>
				<div style={{ fontWeight: "500", marginBottom: "8px" }}>Delete All Checkpoints</div>
				<VSCodeButton onClick={handleDeleteCheckpoints}>
					<i className="codicon codicon-trash" style={{ marginRight: "6px" }} />
					Delete All
				</VSCodeButton>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Permanently remove all saved checkpoints from your system
				</p>
			</div>
		</div>
	)
}

export default memo(CheckpointsSettingsView)
