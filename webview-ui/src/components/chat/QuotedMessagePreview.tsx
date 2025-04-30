import React, { useEffect } from "react"
import styled from "styled-components"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"

const PreviewContainer = styled.div`
	background-color: var(--vscode-input-background); /* Use input background */
	/* border-left: 3px solid var(--vscode-textBlockQuote-border); */ /* Remove left border */
	border-top: 1px solid var(--vscode-editorGroup-border); /* Add subtle top border */
	padding: 8px 12px 8px 12px; /* Adjust padding */
	margin: 0 15px 0 15px; /* Remove bottom margin, align with input */
	/* border-radius: 3px; */ /* Remove border-radius or adjust if needed */
	display: flex;
	flex-direction: column; /* Stack label and text vertically */
	position: relative; /* Keep for button positioning */
`

const Label = styled.div`
	font-size: 0.8em;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 4px;
`

const ContentRow = styled.div`
	display: flex;
	align-items: flex-start; /* Align items (text, button) to the top */
	justify-content: space-between;
	width: 100%;
`

const TextContainer = styled.div`
	flex-grow: 1;
	margin-right: 8px; /* Space before button */
	white-space: pre-wrap;
	word-break: break-word;
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	font-size: var(--vscode-editor-font-size); /* Use editor font size */
	opacity: 0.9; /* Slightly muted text */
	line-height: 1.4; /* Improve readability */
	max-height: calc(1.4 * var(--vscode-editor-font-size) * 3); /* approx 3 lines */
`

const DismissButton = styled(VSCodeButton)`
	/* margin-left: auto; */ /* Removed as ContentRow handles spacing */
	flex-shrink: 0; /* Prevent button from shrinking */
	min-width: 22px;
	height: 22px;
	padding: 0;
	margin-top: -2px; /* Align icon better vertically */
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
			<Label>Replying to:</Label>
			<ContentRow>
				<TextContainer title={text}>{text}</TextContainer>
				<DismissButton appearance="icon" onClick={onDismiss} aria-label="Dismiss quote">
					<span className="codicon codicon-close"></span>
				</DismissButton>
			</ContentRow>
		</PreviewContainer>
	)
}

export default QuotedMessagePreview
