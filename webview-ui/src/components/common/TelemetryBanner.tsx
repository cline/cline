import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import styled from "styled-components"
import { vscode } from "../../utils/vscode"
import { TelemetrySetting } from "../../../../src/shared/TelemetrySetting"

const BannerContainer = styled.div`
	background-color: var(--vscode-banner-background);
	padding: 12px 20px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	flex-shrink: 0;
	margin-bottom: 6px;
`

const ButtonContainer = styled.div`
	display: flex;
	gap: 8px;
	width: 100%;
	& > vscode-button {
		flex: 1;
	}
`

const TelemetryBanner = () => {
	const [hasChosen, setHasChosen] = useState(false)

	const handleAllow = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetrySetting", text: "enabled" satisfies TelemetrySetting })
	}

	const handleDeny = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetrySetting", text: "disabled" satisfies TelemetrySetting })
	}

	const handleOpenSettings = () => {
		window.postMessage({ type: "action", action: "settingsButtonClicked" })
	}

	return (
		<BannerContainer>
			<div>
				<strong>Help Improve Roo Code</strong>
				<div className="mt-1">
					Send anonymous error and usage data to help us fix bugs and improve the extension. No code, prompts,
					or personal information is ever sent.
					<div className="mt-1">
						You can always change this at the bottom of the{" "}
						<VSCodeLink href="#" onClick={handleOpenSettings}>
							settings
						</VSCodeLink>
						.
					</div>
				</div>
			</div>
			<ButtonContainer>
				<VSCodeButton appearance="primary" onClick={handleAllow} disabled={hasChosen}>
					Allow
				</VSCodeButton>
				<VSCodeButton appearance="secondary" onClick={handleDeny} disabled={hasChosen}>
					Deny
				</VSCodeButton>
			</ButtonContainer>
		</BannerContainer>
	)
}

export default memo(TelemetryBanner)
