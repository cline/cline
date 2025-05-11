import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import styled from "styled-components"
import { vscode } from "@/utils/vscode"
import { TelemetrySetting } from "@shared/TelemetrySetting"

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
	const handleOpenSettings = () => {
		vscode.postMessage({ type: "openSettings" })
	}

	return (
		<BannerContainer>
			<div>
				<strong>Help Improve Cline</strong>
				<div style={{ marginTop: 4 }}>
					Cline collects anonymous error and usage data to help us fix bugs and improve the extension. No code, prompts,
					or personal information is ever sent.
					<div style={{ marginTop: 4 }}>
						You can turn this setting off in{" "}
						<VSCodeLink href="#" onClick={handleOpenSettings}>
							settings
						</VSCodeLink>
						.
					</div>
				</div>
			</div>
		</BannerContainer>
	)
}

export default memo(TelemetryBanner)
