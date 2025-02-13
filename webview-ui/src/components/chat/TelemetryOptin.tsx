import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { getAsVar, VSC_INACTIVE_SELECTION_BACKGROUND } from "../../utils/vscStyles"

interface TelemetryOptinProps {
	hide: () => void
}

const TelemetryOptin = ({ hide }: TelemetryOptinProps) => {
	const handleOptIn = () => {
		// vscode.postMessage({ type: "telemetryOptIn" })
		hide()
	}

	const handleCancel = () => {
		// vscode.postMessage({ type: "telemetryOptOut" })
		hide()
	}

	return (
		<div
			style={{
				backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
				borderRadius: "3px",
				padding: "12px 16px",
				margin: "5px 15px 5px 15px",
				position: "relative",
				flexShrink: 0,
			}}>
			<h3 style={{ margin: "0 0 8px" }}>Help Improve Cline</h3>
			<p style={{ margin: "0 0 12px" }}>
				Would you like to help make Cline better by sending anonymous error reports and usage data? No personal or project
				information will be collected. You can change this setting anytime in VS Code preferences.{" "}
				<VSCodeLink href="https://github.com/cline-app/cline/blob/main/PRIVACY.md" style={{ display: "inline" }}>
					Learn more
				</VSCodeLink>
			</p>
			<div style={{ display: "flex", gap: "8px" }}>
				<VSCodeButton appearance="primary" onClick={handleOptIn}>
					Opt In
				</VSCodeButton>
				<VSCodeButton appearance="secondary" onClick={handleCancel}>
					Cancel
				</VSCodeButton>
			</div>
		</div>
	)
}

export default memo(TelemetryOptin)
