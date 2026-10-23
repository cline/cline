import { isCloudTargetReady } from "@shared/cloud/cloud-sessions"
import React from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
		lastMessage,
		pendingResponse,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	const { turnState, cloudSessionsEnabled, cloudTaskTarget, currentCloudTask, clineMessages = [] } = useExtensionState()
	const legacyTaskRunning =
		turnState === undefined &&
		(lastMessage?.partial === true || (lastMessage?.type === "say" && lastMessage.say === "api_req_started"))
	const allowSubmitWhileDisabled =
		turnState?.phase === "streaming" ||
		turnState?.phase === "awaiting_approval" ||
		(messageHandlers.errorRecoveryAvailable && pendingResponse === undefined && !messageHandlers.recoveryActionInFlight) ||
		legacyTaskRunning
	const cloudSelectedForNewTask = clineMessages.length === 0 && !!cloudSessionsEnabled && cloudTaskTarget?.target === "cloud"
	// The task-target panel above the composer shows what is still missing.
	const cloudTargetIncomplete = cloudSelectedForNewTask && !isCloudTargetReady(cloudTaskTarget)
	// Local file paths cannot be read from a cloud sandbox. Refuse the send
	// rather than silently dropping the attachments from the request.
	const cloudFilesUnsupported = cloudSelectedForNewTask && selectedFiles.length > 0
	// A provisioning sandbox has no session to queue a follow-up on yet; the draft stays in the composer.
	const submitDisabled =
		(sendingDisabled && !allowSubmitWhileDisabled) ||
		cloudTargetIncomplete ||
		cloudFilesUnsupported ||
		currentCloudTask?.status === "provisioning"

	return (
		<>
			{cloudFilesUnsupported && (
				<p className="mx-[15px] mt-[10px] mb-0 text-[11px] leading-snug text-description" role="status">
					Attached files can't be sent to a cloud sandbox. Remove them, or mention them in the prompt and let the agent
					read them from the repository.
				</p>
			)}
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			<ChatTextArea
				activeQuote={activeQuote}
				inputValue={inputValue}
				onFocusChange={handleFocusChange}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={() => messageHandlers.handleSendMessage(inputValue, selectedImages, selectedFiles)}
				placeholderText={placeholderText}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={submitDisabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
