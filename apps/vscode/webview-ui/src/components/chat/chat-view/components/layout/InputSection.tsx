import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	/**
	 * Auth/usability gate: when true there is no usable provider (no Cline auth,
	 * no BYOK key, and no usable keyless/cloud config like Vertex ADC), so
	 * message submission is blocked and an inline "sign in or set up provider"
	 * prompt is shown. Kept separate from
	 * ChatState.sendingDisabled (the turn-state send lock).
	 */
	inputGated?: boolean
}

/**
 * Inline prompt shown above the text area when there is no usable provider.
 * Offers signing in to Cline (primary) or opening settings to configure a provider.
 */
const NoUsableProviderPrompt: React.FC = () => {
	const { navigateToSettings } = useExtensionState()

	const handleSignIn = () => {
		AccountServiceClient.accountLoginClicked(EmptyRequest.create()).catch((err) =>
			console.error("Failed to start Cline sign-in:", err),
		)
	}

	return (
		<div
			className="rounded border border-(--vscode-inputValidation-warningBorder) bg-(--vscode-inputValidation-warningBackground) px-3 py-2.5 text-(--vscode-foreground) mx-3.5"
			data-testid="no-usable-provider-prompt">
			<p className="m-0 mb-2 text-xs leading-snug">Sign in to Cline or set up a provider.</p>
			<div className="flex gap-2">
				<VSCodeButton appearance="primary" data-testid="no-usable-provider-sign-in" onClick={handleSignIn}>
					Sign in
				</VSCodeButton>
				<VSCodeButton
					appearance="secondary"
					data-testid="no-usable-provider-add-key"
					onClick={() => navigateToSettings()}>
					Set up provider
				</VSCodeButton>
			</div>
		</div>
	)
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
	inputGated = false,
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

	return (
		<>
			{inputGated && <NoUsableProviderPrompt />}

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
				// OR the auth/usability gate into the turn-state send lock so the
				// textarea + send button disable when there is no usable provider.
				sendingDisabled={sendingDisabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
