import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { TelemetrySettingEnum, TelemetrySettingRequest } from "@shared/proto/state"

const BannerContainer = styled.div`
	background-color: var(--vscode-banner-background);
	padding: 12px 20px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	flex-shrink: 0;
	margin-bottom: 6px;
	position: relative;
`

const CloseButton = styled.button`
	position: absolute;
	top: 12px;
	right: 12px;
	background: none;
	border: none;
	color: var(--vscode-foreground);
	cursor: pointer;
	font-size: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 4px;
	opacity: 0.7;
	&:hover {
		opacity: 1;
	}
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
	const { navigateToSettings } = useExtensionState()

	const handleOpenSettings = () => {
		handleClose()
		navigateToSettings()
	}

	const handleClose = async () => {
		try {
			await StateServiceClient.updateTelemetrySetting(
				TelemetrySettingRequest.create({
					setting: TelemetrySettingEnum.ENABLED,
				}),
			)
		} catch (error) {
			console.error("Error updating telemetry setting:", error)
		}
	}

	return (
		<BannerContainer>
			<CloseButton onClick={handleClose} aria-label="Close banner and enable telemetry">
				✕
			</CloseButton>
			<div>
				<strong>Help Improve Cline</strong>
				<i>
					<br />
					(and access experimental features)
				</i>
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
