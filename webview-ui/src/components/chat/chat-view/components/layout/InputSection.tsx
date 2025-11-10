import React, { useState } from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import VoiceRecorder from "@/components/chat/VoiceRecorder"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	stopAudio: () => void
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
	stopAudio,
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
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	const { discussModeEnabled, dictationSettings, mode } = useExtensionState()
	const { clineUser } = useClineAuth()
	const [isVoiceRecording, setIsVoiceRecording] = useState(false)

	// Check if we should show voice-only mode (Discuss Mode enabled in Plan mode)
	const showVoiceOnlyMode = discussModeEnabled && mode === "plan"

	return (
		<>
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			{showVoiceOnlyMode ? (
				// Voice-only mode for Discuss Mode
				<div className="flex justify-center items-center py-8 px-4">
					<div className="flex flex-col items-center gap-4">
						<VoiceRecorder
							disabled={sendingDisabled}
							isAuthenticated={!!clineUser?.uid}
							language={dictationSettings?.dictationLanguage || "en"}
							onProcessingStateChange={(isProcessing, message) => {
								// No need to show processing in input since there's no text field
							}}
							onRecordingStateChange={(isRecording) => {
								setIsVoiceRecording(isRecording)
								// Stop any playing audio when user starts recording
								if (isRecording) {
									stopAudio()
								}
							}}
							onTranscription={(text) => {
								if (!text) return

								// Create blessed audio element during user gesture (transcription completion)
								try {
									const audio = new Audio()
									audio.preload = "auto"
									// Store in window for the audio hook to access
									;(window as any).__discussModeAudio = audio
								} catch (e) {
									console.warn("Could not create blessed audio element:", e)
								}

								// Automatically send the message
								messageHandlers.handleSendMessage(text, [], [])
							}}
						/>
						{!isVoiceRecording && (
							<p className="text-xs text-muted-foreground text-center">Click the microphone to speak</p>
						)}
					</div>
				</div>
			) : (
				// Normal mode with full text area
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
					sendingDisabled={sendingDisabled}
					setInputValue={setInputValue}
					setSelectedFiles={setSelectedFiles}
					setSelectedImages={setSelectedImages}
					shouldDisableFilesAndImages={shouldDisableFilesAndImages}
				/>
			)}
		</>
	)
}
