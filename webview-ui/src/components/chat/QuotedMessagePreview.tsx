import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import styled from "styled-components"

const PreviewContainer = styled.div`
	background-color: var(--vscode-input-background); /* Outer box matches text area */
	/* border-left: 3px solid var(--vscode-textBlockQuote-border); */ /* Remove left border */
	/* border-top: 1px solid var(--vscode-editorGroup-border); */ /* Remove top border */
	padding: 4px 4px 4px 4px; /* Removed bottom padding */
	margin: 0px 15px 0 15px; /* Remove bottom+top margin, equal left/right */
	border-radius: 2px 2px 0 0; /* Only round top corners */
	display: flex;
	/* flex-direction: column; */ /* No longer needed as Label is removed */
	position: relative; /* Keep for button positioning */
`

// Removed Label component

const ContentRow = styled.div`
	/* Mix outer background with white to ensure a much lighter inner box */
	background-color: color-mix(in srgb, var(--vscode-input-background) 70%, white 30%);
	border-radius: 2px 2px 2px 2px; /* Round top corners, square bottom corners */
	padding: 8px 10px 10px 8px; /* Reduced left padding */
	display: flex;
	align-items: flex-start; /* Align items to the top */
	justify-content: space-between;
	width: 100%;
`

const TextContainer = styled.div`
	flex-grow: 1;
	margin: 0 2px; /* Further reduced space around text */
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
	/* margin-top: 20px; */ /* Remove top margin */
	display: flex;
	align-items: center;
	justify-content: center;
`

const ReplyIcon = styled.span`
	color: var(--vscode-descriptionForeground);
	margin-right: 2px; /* Further reduced space between icon and text */
	flex-shrink: 0;
	font-size: 13px; /* Make icon even smaller */
	/* transform: translateY(-1px); */ /* Removed vertical transform */
`

interface QuotedMessagePreviewProps {
	text: string
	onDismiss: () => void
	isFocused?: boolean
}

const QuotedMessagePreview: React.FC<QuotedMessagePreviewProps> = ({ text, onDismiss, isFocused }) => {
	const _cardClassName = `reply-card ${isFocused ? "reply-card--focused" : ""}`

	return (
		<PreviewContainer>
			{/* Removed Label */}
			<ContentRow>
				<ReplyIcon className="codicon codicon-reply"></ReplyIcon>
				<TextContainer title={text}>{text}</TextContainer>
				<DismissButton appearance="icon" aria-label="Dismiss quote" onClick={onDismiss}>
					<span className="codicon codicon-close"></span>
				</DismissButton>
			</ContentRow>
		</PreviewContainer>
	)
}

export default QuotedMessagePreview
