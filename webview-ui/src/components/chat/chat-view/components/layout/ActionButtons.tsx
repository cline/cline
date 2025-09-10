import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BUTTON_CONFIGS, ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"
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

interface ActionButtonConfig {
	text?: string
	action?: ButtonActionType
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
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled } = chatState

	const isStreaming = useMemo(() => task?.partial === true, [task])

	const [primaryButtonConfig, setPrimaryButtonConfig] = useState<ActionButtonConfig | undefined>(undefined)
	const [secondaryButtonConfig, setSecondaryButtonConfig] = useState<ActionButtonConfig | undefined>(undefined)

	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [isProcessingClick, setIsProcessingClick] = useState<boolean>(false)

	const [lastMessage, secondLastMessage] = useMemo(() => {
		return [messages.at(-1), messages.at(-2)]
	}, [messages])

	const handleActionClick = useCallback(
		(action?: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			if (!action) {
				return
			}
			setIsProcessingClick(true)
			messageHandlers.executeButtonAction(action, text, images, files)
		},
		[messageHandlers],
	)

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [chatState, lastMessage, secondLastMessage])

	// Apply button configuration with a single batched update
	useEffect(() => {
		const buttonConfig = lastMessage ? getButtonConfig(lastMessage, mode) : BUTTON_CONFIGS.default
		setEnableButtons(buttonConfig.enableButtons)
		setSendingDisabled(buttonConfig.sendingDisabled)
		setPrimaryButtonConfig({
			text: buttonConfig.primaryText,
			action: buttonConfig.primaryAction,
		})
		setSecondaryButtonConfig({
			text: buttonConfig.secondaryText,
			action: buttonConfig.secondaryAction,
		})
		// Reset processing state when configuration changes (new message received)
		setIsProcessingClick(false)
	}, [lastMessage, mode, setSendingDisabled])

	// Keyboard event listener
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// ESC to cancel the task in progress.
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				messageHandlers.executeButtonAction("cancel")
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [lastMessage])

	if (!task) {
		return null
	}

	const { showScrollToBottom, scrollToBottomSmooth, disableAutoScrollRef } = scrollBehavior

	if (showScrollToBottom) {
		const handleScrollToBottom = () => {
			scrollToBottomSmooth()
			disableAutoScrollRef.current = false
		}

		return (
			<div className="flex px-[15px]">
				<VSCodeButton
					appearance="icon"
					aria-label="Scroll to bottom"
					className="text-lg text-[var(--vscode-primaryButton-foreground)] bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_55%,transparent)] rounded-[3px] overflow-hidden cursor-pointer flex justify-center items-center flex-1 h-[25px] hover:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_90%,transparent)] active:bg-[color-mix(in_srgb,var(--vscode-toolbar-hoverBackground)_70%,transparent)] border-0"
					onClick={handleScrollToBottom}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							handleScrollToBottom()
						}
					}}>
					<span className="codicon codicon-chevron-down" />
				</VSCodeButton>
			</div>
		)
	}

	const shouldShowButtons = primaryButtonConfig?.text || secondaryButtonConfig?.text
	const enableAndNotProcessing = enableButtons && !isProcessingClick
	const opacity = shouldShowButtons ? (enableAndNotProcessing || isStreaming ? 1 : 0.5) : 0

	return (
		<div className="flex px-[15px]" style={{ opacity }}>
			{primaryButtonConfig?.text && primaryButtonConfig?.action && (
				<VSCodeButton
					appearance="primary"
					className={`${secondaryButtonConfig?.text ? "flex-1 mr-[6px]" : "flex-[2]"}`}
					disabled={!enableAndNotProcessing}
					onClick={() => handleActionClick(primaryButtonConfig.action, inputValue, selectedImages, selectedFiles)}>
					{primaryButtonConfig.text}
				</VSCodeButton>
			)}
			{secondaryButtonConfig?.text && secondaryButtonConfig?.action && (
				<VSCodeButton
					appearance="secondary"
					className={`${primaryButtonConfig?.text ? "flex-1 mr-[6px]" : "flex-[2]"}`}
					disabled={!enableAndNotProcessing}
					onClick={() => handleActionClick(secondaryButtonConfig.action, inputValue, selectedImages, selectedFiles)}>
					{secondaryButtonConfig.text}
				</VSCodeButton>
			)}
		</div>
	)
}
