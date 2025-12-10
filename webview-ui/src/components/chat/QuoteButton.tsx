import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import styled from "styled-components"

interface QuoteButtonProps {
	top: number
	left: number
	onClick: () => void
}

// Define props specifically for the styled component using transient props
interface ButtonContainerProps {
	$top: number
	$left: number
}

const ButtonContainer = styled.div<ButtonContainerProps>`
	position: absolute;
	top: ${(props) => props.$top}px; // Use transient prop $top
	left: ${(props) => props.$left}px; // Use transient prop $left
	z-index: 10; // Ensure it's above the text
	background-color: var(--vscode-button-background);
	border: 1px solid var(--vscode-button-border);
	border-radius: 4px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	transition: transform 0.1s ease;

	&:hover {
		transform: scale(1.05);
		background-color: var(--vscode-button-hoverBackground);
	}
`

const QuoteButton: React.FC<QuoteButtonProps> = ({ top, left, onClick }) => {
	return (
		// Pass transient props to the styled component
		<ButtonContainer $left={left} $top={top} className="quote-button-class">
			<VSCodeButton
				appearance="icon"
				aria-label="Quote selection"
				onClick={(e) => {
					e.stopPropagation() // Prevent triggering mouseup on the parent
					onClick()
				}}
				style={{ padding: "2px 4px", height: "auto", minWidth: "auto" }}
				title="Quote selection in reply">
				{" "}
				{/* Adjust padding */}
				<span
					className="codicon codicon-quote"
					style={{ fontSize: "12px", color: "var(--vscode-button-foreground)" }}></span>{" "}
				{/* Adjust font size */}
			</VSCodeButton>
		</ButtonContainer>
	)
}

export default QuoteButton
