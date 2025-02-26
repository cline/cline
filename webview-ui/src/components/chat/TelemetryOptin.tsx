import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useState, useEffect } from "react"
import { getAsVar, VSC_INACTIVE_SELECTION_BACKGROUND } from "../../utils/vscStyles"
import { vscode } from "../../utils/vscode"

const boxStyles = {
	backgroundColor: getAsVar(VSC_INACTIVE_SELECTION_BACKGROUND),
	borderRadius: "3px",
	padding: "12px 16px",
	margin: "5px 15px 5px 15px",
	position: "relative" as const,
	flexShrink: 0,
	minHeight: "120px",
	display: "flex",
	flexDirection: "column" as const,
	justifyContent: "center" as const,
}

const TelemetryOptin = () => {
	const [showThankYou, setShowThankYou] = useState(false)
	const [isVisible, setIsVisible] = useState(true)

	useEffect(() => {
		if (showThankYou) {
			const fadeTimer = setTimeout(() => {
				setIsVisible(false)
			}, 1500)

			const closeTimer = setTimeout(() => {
				vscode.postMessage({ type: "toggleTelemetryOptIn", bool: true })
			}, 2000)

			return () => {
				clearTimeout(fadeTimer)
				clearTimeout(closeTimer)
			}
		}
	}, [showThankYou])

	const handleOptIn = () => {
		setShowThankYou(true)
	}

	const handleCancel = () => {
		vscode.postMessage({ type: "toggleTelemetryOptIn", bool: false })
	}

	if (showThankYou) {
		return (
			<div
				style={{
					...boxStyles,
					opacity: isVisible ? 1 : 0,
					transition: "opacity 0.5s ease-out",
					textAlign: "center",
				}}>
				<h3 style={{ margin: "0" }}>Thank you for helping improve Cline!</h3>
			</div>
		)
	}

	return (
		<div style={boxStyles}>
			<h3 style={{ margin: "0 0 8px" }}>Help Improve Cline</h3>
			<p style={{ margin: "0 0 12px" }}>
				Would you like to help make Cline better by sending anonymous error reports and usage data? No personal or project
				information will be collected. You can change this setting anytime in{" "}
				<VSCodeLink onClick={() => vscode.postMessage({ type: "openExtensionSettings" })}>VS Code preferences</VSCodeLink>
				.{" "}
				<VSCodeLink href="https://github.com/cline/cline/blob/main/docs/PRIVACY.md" style={{ display: "inline" }}>
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
