import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BUTTON_CONFIGS, getButtonConfig } from "../../shared/buttonConfig"
import type { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	task?: ClineMessage
	messages: ClineMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
	scrollBehavior: {
		scrollToBottomSmooth: () => void
		disableAutoScrollRef: React.MutableRefObject<boolean>
		showScrollToBottom: boolean
	}
}

/**
 * Action buttons area including scroll-to-bottom and approve/reject buttons
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
	task,
	messages,
	chatState,
	mode,
	messageHandlers,
	scrollBehavior,
}) => {
	const { didClickCancel, inputValue, selectedImages, selectedFiles, setSendingDisabled, setDidClickCancel } = chatState

	const [isStreaming, setIsStreaming] = useState(task?.partial === true)

	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)

	const [enableButtons, setEnableButtons] = useState<boolean>(false)

	const [lastMessage, secondLastMessage] = useMemo(() => {
		return [messages.at(-1), messages.at(-2)]
	}, [messages])

	// Memoize the button configuration to avoid recalculation
	const buttonConfig = useMemo(() => {
		// Special case: api_req_started after command_output needs special handling
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			return BUTTON_CONFIGS.api_req_active
		}

		return getButtonConfig(lastMessage, mode)
	}, [lastMessage, secondLastMessage, mode])

	// Apply button configuration with a single batched update
	useEffect(() => {
		// Batch all state updates together to prevent intermediate renders
		setEnableButtons(buttonConfig.enableButtons)
		setSendingDisabled(buttonConfig.sendingDisabled)
		setPrimaryButtonText(buttonConfig.primaryText)
		setSecondaryButtonText(buttonConfig.secondaryText)

		// Handle special state changes for resume tasks
		if (task?.ask === "resume_task" || task?.ask === "resume_completed_task") {
			setDidClickCancel(false)
		} else {
			setIsStreaming(task?.partial === true)
		}
	}, [buttonConfig, task?.ask, task?.partial, setSendingDisabled, setDidClickCancel])

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			if (chatState.inputValue) {
				chatState.setInputValue("")
			}
			if (chatState.selectedImages.length) {
				chatState.setSelectedImages([])
			}
			if (chatState.selectedFiles.length) {
				chatState.setSelectedFiles([])
			}
		}
	}, [chatState, lastMessage, secondLastMessage])

	const reset = useCallback(() => {
		const defaultConfig = isStreaming ? BUTTON_CONFIGS.api_req_active : BUTTON_CONFIGS.default
		setSendingDisabled(defaultConfig.sendingDisabled)
		setEnableButtons(defaultConfig.enableButtons)
		setPrimaryButtonText(defaultConfig.primaryText)
		setSecondaryButtonText(defaultConfig.secondaryText)
	}, [isStreaming, setSendingDisabled])

	// Reset button state when conversation is cleared
	useEffect(() => {
		if (!messages?.length) {
			reset()
		}
	}, [messages.length, reset])

	const { showScrollToBottom, scrollToBottomSmooth, disableAutoScrollRef } = scrollBehavior

	if (showScrollToBottom) {
		const handleScrollToBottom = () => {
			scrollToBottomSmooth()
			disableAutoScrollRef.current = false
		}

		return (
			<div className="flex px-[15px] pt-[10px]">
				<VSCodeButton
					appearance="icon"
					className="text-lg text-[var(--vscode-primaryButton-foreground)] bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_55%,transparent)] rounded-[3px] overflow-hidden cursor-pointer flex justify-center items-center flex-1 h-[25px] hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_90%,transparent)] active:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_70%,transparent)] border-0"
					onClick={handleScrollToBottom}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							handleScrollToBottom()
						}
					}}
					aria-label="Scroll to bottom">
					<span className="codicon codicon-chevron-down" />
				</VSCodeButton>
			</div>
		)
	}

	const shouldShowButtons = primaryButtonText || secondaryButtonText || isStreaming
	const opacity = shouldShowButtons ? (enableButtons || (isStreaming && !didClickCancel) ? 1 : 0.5) : 0

	return (
		<div className={`flex px-[15px] ${shouldShowButtons ? "pt-[10px]" : "pt-0"}`} style={{ opacity }}>
			{primaryButtonText && (
				<VSCodeButton
					appearance="primary"
					disabled={!enableButtons}
					className={`${secondaryButtonText ? "flex-1 mr-[6px]" : "flex-[2]"}`}
					onClick={() => {
						if (primaryButtonText === "Start New Task") {
							messageHandlers.startNewTask()
						} else {
							messageHandlers.handleButtonClick(primaryButtonText, inputValue, selectedImages, selectedFiles)
						}
						reset()
					}}>
					{primaryButtonText}
				</VSCodeButton>
			)}
			{secondaryButtonText && (
				<VSCodeButton
					appearance="secondary"
					disabled={isStreaming ? didClickCancel : !enableButtons}
					className={`${isStreaming ? "flex-[2]" : "flex-1 ml-[6px]"}`}
					onClick={() => {
						messageHandlers.handleButtonClick(
							isStreaming ? "Cancel" : secondaryButtonText,
							inputValue,
							selectedImages,
							selectedFiles,
						)
						reset()
					}}>
					{isStreaming ? "Cancel" : secondaryButtonText}
				</VSCodeButton>
			)}
		</div>
	)
}
