import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

const StyledButton = styled(VSCodeButton)`
	--danger-button-bg: #c42b2b;
	--danger-button-hover: #a82424;
	--danger-button-active: #8f1f1f;

	background-color: var(--danger-button-bg) !important;
	border-color: var(--danger-button-bg) !important;
	color: #ffffff !important;

	&:hover {
		background-color: var(--danger-button-hover) !important;
		border-color: var(--danger-button-hover) !important;
	}

	&:active {
		background-color: var(--danger-button-active) !important;
		border-color: var(--danger-button-active) !important;
	}
`

interface DangerButtonProps extends React.ComponentProps<typeof VSCodeButton> {}

const DangerButton: React.FC<DangerButtonProps> = (props) => {
	return <StyledButton {...props} />
}

export default DangerButton
