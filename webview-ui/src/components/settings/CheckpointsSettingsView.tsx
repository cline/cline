import { VSCodeButton, VSCodeLink, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import { vscode } from "../../utils/vscode"
import type { CheckpointSettings } from "../../../../src/shared/WebviewMessage"

const CheckpointsSettingsView = () => {
	const [settings, setSettings] = useState<CheckpointSettings>({
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
				case "checkpointSettings": {
					const newSettings = message.checkpointSettings
					setSettings(newSettings)
				}
			}
		}

		window.addEventListener("message", messageHandler)
		return () => window.removeEventListener("message", messageHandler)
	}, [])

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
