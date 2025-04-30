import React from "react"
import styled from "styled-components"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

interface QuoteButtonProps {
	top: number
	left: number
	onClick: () => void
}

const ButtonContainer = styled.div<{ top: number; left: number }>`
	position: absolute;
	top: ${(props) => props.top}px;
	left: ${(props) => props.left}px;
	z-index: 10; // Ensure it's above the text
	background-color: var(--vscode-editorWidget-background);
	border: 1px solid var(--vscode-editorWidget-border);
	border-radius: 4px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`

const QuoteButton: React.FC<QuoteButtonProps> = ({ top, left, onClick }) => {
	return (
		<ButtonContainer top={top} left={left} className="quote-button-class">
			<VSCodeButton
				appearance="icon"
				aria-label="Quote selection"
				onClick={(e) => {
					e.stopPropagation() // Prevent triggering mouseup on the parent
					onClick()
				}}
				style={{ padding: "2px 4px", height: "auto", minWidth: "auto" }}>
				<span className="codicon codicon-quote" style={{ fontSize: "12px" }}></span>
			</VSCodeButton>
		</ButtonContainer>
	)
}

export default QuoteButton
