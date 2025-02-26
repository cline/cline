import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import styled from "styled-components"
import { vscode } from "../../utils/vscode"

const BannerContainer = styled.div`
	background-color: var(--vscode-banner-background);
	padding: 12px 20px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	flex-shrink: 0;
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
		vscode.postMessage({ type: "telemetryOptIn", bool: true })
	}

	const handleDeny = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetryOptIn", bool: false })
	}

	const handleOpenSettings = () => {
		vscode.postMessage({ type: "openTelemetrySettings" })
	}

	return (
		<BannerContainer>
			<div>
				<strong>Help Improve Cline</strong>
				<div style={{ marginTop: 4 }}>
					Send anonymous error and usage data to help us fix bugs and improve the extension. No code, prompts, or
					personal information is ever sent.
					<div style={{ marginTop: 4 }}>
						You can always change this in{" "}
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
