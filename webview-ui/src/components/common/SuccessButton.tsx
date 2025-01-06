import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"

const StyledButton = styled(VSCodeButton)`
	--success-button-bg: #176f2c;
	--success-button-hover: #197f31;
	--success-button-active: #156528;

	background-color: var(--success-button-bg) !important;
	border-color: var(--success-button-bg) !important;
	color: #ffffff !important;

	&:hover {
		background-color: var(--success-button-hover) !important;
		border-color: var(--success-button-hover) !important;
	}

	&:active {
		background-color: var(--success-button-active) !important;
		border-color: var(--success-button-active) !important;
	}
`

interface SuccessButtonProps extends React.ComponentProps<typeof VSCodeButton> {}

const SuccessButton: React.FC<SuccessButtonProps> = (props) => {
	return <StyledButton {...props} />
}

export default SuccessButton
