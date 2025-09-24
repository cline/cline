import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

const StyledButton = styled(VSCodeButton)`
	--settings-button-bg: var(--vscode-button-secondaryBackground);
	--settings-button-hover: var(--vscode-button-secondaryHoverBackground);
	--settings-button-active: var(--vscode-button-secondaryBackground);

	background-color: var(--settings-button-bg) !important;
	border-color: var(--settings-button-bg) !important;
	width: 100% !important;

	&:hover {
		background-color: var(--settings-button-hover) !important;
		border-color: var(--settings-button-hover) !important;
	}

	&:active {
		background-color: var(--settings-button-active) !important;
		border-color: var(--settings-button-active) !important;
	}

	i.codicon {
		margin-right: 6px;
		shrink: 0;
		font-size: 16px !important;
	}
`

interface SettingsButtonProps extends React.ComponentProps<typeof VSCodeButton> {}

const SettingsButton: React.FC<SettingsButtonProps> = (props) => {
	return <StyledButton appearance="secondary" {...props} />
}

export default SettingsButton
