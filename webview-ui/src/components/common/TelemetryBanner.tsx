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
		vscode.postMessage({ type: "telemetrySetting", telemetrySetting: "enabled" satisfies TelemetrySetting })
	}

	const handleDeny = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetrySetting", telemetrySetting: "disabled" satisfies TelemetrySetting })
	}

	const handleOpenSettings = () => {
		vscode.postMessage({ type: "openSettings" })
	}

	return (
		<BannerContainer>
			<div>
				<strong>帮助改进Cline 中文版本</strong>
				<div style={{ marginTop: 4 }}>
					发送匿名错误和使用数据以帮助我们修复错误并改进扩展。不会发送任何代码、提示或个人信息。
					<div style={{ marginTop: 4 }}>
						您始终可以在{" "}
						<VSCodeLink href="#" onClick={handleOpenSettings}>
							设置
						</VSCodeLink>
						。
					</div>
				</div>
			</div>
			<ButtonContainer>
				<VSCodeButton appearance="primary" onClick={handleAllow} disabled={hasChosen}>
					允许
				</VSCodeButton>
				<VSCodeButton appearance="secondary" onClick={handleDeny} disabled={hasChosen}>
					拒绝
				</VSCodeButton>
			</ButtonContainer>
		</BannerContainer>
	)
}

export default memo(TelemetryBanner)
