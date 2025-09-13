import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { usePlatform } from "@/context/PlatformContext"
import { ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"
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
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled } = chatState
	const isProcessingRef = useRef(false)

	// Memoize last messages to avoid unnecessary recalculations
	const [lastMessage, secondLastMessage] = useMemo(() => {
		const len = messages.length
		return len > 0 ? [messages[len - 1], messages[len - 2]] : [undefined, undefined]
	}, [messages])

	// Memoize button configuration to avoid recalculation on every render
	const buttonConfig = useMemo(() => {
		if (!lastMessage) {
			return { sendingDisabled: false, enableButtons: false }
		}
		// Append keybinding display to button text if available
		const btnConfig = getButtonConfig(lastMessage, mode)
		const config = { ...btnConfig } // Create a shallow copy to avoid mutating original
		// HACK: Append keybinding only if the platform doesn't show navbar to determine if host is VS Code or not.
		const showKeybindings = usePlatform().showNavbar !== true
		const primaryButtonKey = config.primaryKeybinding?.display
		const secondaryButtonKey = config.secondaryKeybinding?.display
		if (primaryButtonKey) {
			config.primaryText = showKeybindings ? `${config.primaryText} (${primaryButtonKey})` : config.primaryText
		}
		if (secondaryButtonKey) {
			config.secondaryText = showKeybindings ? `${config.secondaryText} (${secondaryButtonKey})` : config.secondaryText
		}
		// Return the modified config
		return config
	}, [lastMessage, mode])

	// Single effect to handle all configuration updates
	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
		isProcessingRef.current = false
	}, [buttonConfig, setSendingDisabled])

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [lastMessage?.type, lastMessage?.say, secondLastMessage?.ask, chatState])

	// Optimized action handler with ref to avoid processing state updates
	const handleActionClick = useCallback(
		(action: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			if (isProcessingRef.current) {
				return
			}
			isProcessingRef.current = true
			messageHandlers.executeButtonAction(action, text, images, files)
		},
		[messageHandlers],
	)

	// Keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			const primaryKey = buttonConfig.primaryKeybinding?.key.join("+")
			if (buttonConfig.primaryAction && primaryKey && event.key === primaryKey) {
				event.preventDefault()
				event.stopPropagation()
				messageHandlers.executeButtonAction(buttonConfig.primaryAction)
			}
			const secondaryKey = buttonConfig.secondaryKeybinding?.key.join("+")
			if (event.key === secondaryKey && buttonConfig.secondaryAction) {
				event.preventDefault()
				event.stopPropagation()
				messageHandlers.executeButtonAction(buttonConfig.secondaryAction)
			}
		},
		[messageHandlers],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	if (!task) {
		return null
	}

	const { showScrollToBottom, scrollToBottomSmooth, disableAutoScrollRef } = scrollBehavior

	// Early return for scroll button to avoid unnecessary computation
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

	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = primaryText || secondaryText
	const isStreaming = task.partial === true
	const canInteract = enableButtons && !isProcessingRef.current

	if (!hasButtons) {
		return null
	}

	const opacity = canInteract || isStreaming ? 1 : 0.5

	return (
		<div className="flex px-[15px]" style={{ opacity }}>
			{primaryText && primaryAction && (
				<VSCodeButton
					appearance="primary"
					className={secondaryText ? "flex-1 mr-[6px]" : "flex-[2]"}
					disabled={!canInteract}
					onClick={() => handleActionClick(primaryAction, inputValue, selectedImages, selectedFiles)}>
					{primaryText}
				</VSCodeButton>
			)}
			{secondaryText && secondaryAction && (
				<VSCodeButton
					appearance="secondary"
					className={primaryText ? "flex-1 mr-[6px]" : "flex-[2]"}
					disabled={!canInteract}
					onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}>
					{secondaryText}
				</VSCodeButton>
			)}
		</div>
	)
}
