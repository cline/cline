import React from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"
import { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	isStreaming: boolean
	scrollBehavior: {
		scrollToBottomSmooth: () => void
		disableAutoScrollRef: React.MutableRefObject<boolean>
		showScrollToBottom: boolean
	}
}

/**
 * Action buttons area including scroll-to-bottom and approve/reject buttons
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({ chatState, messageHandlers, isStreaming, scrollBehavior }) => {
	const { primaryButtonText, secondaryButtonText, enableButtons, didClickCancel, inputValue, selectedImages, selectedFiles } =
		chatState

	const { showScrollToBottom, scrollToBottomSmooth, disableAutoScrollRef } = scrollBehavior

	if (showScrollToBottom) {
		return (
			<div
				style={{
					display: "flex",
					padding: "10px 15px 0px 15px",
				}}>
				<ScrollToBottomButton
					onClick={() => {
						scrollToBottomSmooth()
						disableAutoScrollRef.current = false
					}}>
					<span className="codicon codicon-chevron-down" style={{ fontSize: "18px" }}></span>
				</ScrollToBottomButton>
			</div>
		)
	}

	const shouldShowButtons = primaryButtonText || secondaryButtonText || isStreaming
	const opacity = shouldShowButtons ? (enableButtons || (isStreaming && !didClickCancel) ? 1 : 0.5) : 0

	return (
		<div
			style={{
				opacity,
				display: "flex",
				padding: `${shouldShowButtons ? "10" : "0"}px 15px 0px 15px`,
			}}>
			{primaryButtonText && !isStreaming && (
				<VSCodeButton
					appearance="primary"
					disabled={!enableButtons}
					style={{
						flex: secondaryButtonText ? 1 : 2,
						marginRight: secondaryButtonText ? "6px" : "0",
					}}
					onClick={() => messageHandlers.handlePrimaryButtonClick(inputValue, selectedImages, selectedFiles)}>
					{primaryButtonText}
				</VSCodeButton>
			)}
			{(secondaryButtonText || isStreaming) && (
				<VSCodeButton
					appearance="secondary"
					disabled={!enableButtons && !(isStreaming && !didClickCancel)}
					style={{
						flex: isStreaming ? 2 : 1,
						marginLeft: isStreaming ? 0 : "6px",
					}}
					onClick={() => messageHandlers.handleSecondaryButtonClick(inputValue, selectedImages, selectedFiles)}>
					{isStreaming ? "Cancel" : secondaryButtonText}
				</VSCodeButton>
			)}
		</div>
	)
}

const ScrollToBottomButton = styled.div`
	background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 55%, transparent);
	border-radius: 3px;
	overflow: hidden;
	cursor: pointer;
	display: flex;
	justify-content: center;
	align-items: center;
	flex: 1;
	height: 25px;

	&:hover {
		background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 90%, transparent);
	}

	&:active {
		background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 70%, transparent);
	}
`
