import React, { useEffect } from "react"
import styled from "styled-components"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

const PreviewContainer = styled.div`
	background-color: var(--vscode-textBlockQuote-background);
	border-left: 3px solid var(--vscode-textBlockQuote-border);
	padding: 6px 10px 6px 10px;
	margin: 0 15px 5px 15px; /* Match ChatTextArea margins */
	border-radius: 3px;
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	font-size: 0.9em;
	max-height: 100px; /* Limit height */
	overflow: hidden; /* Hide overflow */
	position: relative; /* For absolute positioning of fade */
`

const TextContainer = styled.div`
	flex-grow: 1;
	margin-right: 10px;
	white-space: pre-wrap; /* Preserve whitespace and wrap */
	word-break: break-word;
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 3; /* Limit to 3 lines */
	-webkit-box-orient: vertical;
`

const DismissButton = styled(VSCodeButton)`
	margin-left: auto;
	min-width: 20px; /* Ensure button is clickable */
	height: 20px;
	padding: 0;
	display: flex;
	align-items: center;
	justify-content: center;
`

interface QuotedMessagePreviewProps {
	text: string
	onDismiss: () => void
}

const QuotedMessagePreview: React.FC<QuotedMessagePreviewProps> = ({ text, onDismiss }) => {
	console.log("[QuotedMessagePreview] Rendering with text:", text) // Log component render
	useEffect(() => {
		console.log("[QuotedMessagePreview] Rendering with text:", text) // Log component render
	}, [text])

	return (
		<PreviewContainer>
			<TextContainer title={text}>{text}</TextContainer>
			<DismissButton appearance="icon" onClick={onDismiss} aria-label="Dismiss quote">
				<span className="codicon codicon-close"></span>
			</DismissButton>
		</PreviewContainer>
	)
}

export default QuotedMessagePreview
