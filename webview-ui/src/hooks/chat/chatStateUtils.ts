import { ChatState, ChatStateContext } from "./chatStateTypes"
import { ClineMessage } from "@shared/ExtensionMessage"

export function deriveContextFromState(
	state: ChatState,
): Omit<ChatStateContext, "inputValue" | "selectedImages" | "selectedFiles" | "activeQuote"> {
	const sendingDisabled =
		state.type === "SENDING_MESSAGE" || state.type === "CREATING_TASK" || state.type === "STREAMING_RESPONSE"
	const enableButtons = state.type.startsWith("AWAITING")

	let primaryButtonText: string | undefined
	let secondaryButtonText: string | undefined

	if (state.type === "AWAITING_COMMAND_APPROVAL") {
		primaryButtonText = "Run Command"
		secondaryButtonText = "Reject"
	} else if (state.type === "AWAITING_TOOL_APPROVAL") {
		primaryButtonText = "Approve"
		secondaryButtonText = "Reject"
	}

	const placeholderText = state.type === "NO_TASK" ? "Type your task here..." : "Type a message..."

	return {
		sendingDisabled,
		enableButtons,
		primaryButtonText,
		secondaryButtonText,
		placeholderText,
		shouldClearInputOnSend: true, // Default, can be customized per state
		shouldFocusInput: true, // Default
		canToggleMode: state.type !== "CREATING_TASK" && state.type !== "SENDING_MESSAGE",
	}
}

export function deriveInitialState(lastMessage?: ClineMessage): ChatState {
	if (!lastMessage) {
		return { type: "IDLE" }
	}
	if (lastMessage.type === "ask") {
		switch (lastMessage.ask) {
			case "tool":
				return { type: "AWAITING_TOOL_APPROVAL", tool: { name: "unknown" }, canProvideInput: true }
			case "command":
				return { type: "AWAITING_COMMAND_APPROVAL", command: lastMessage.text || "", canProvideInput: true }
			case "command_output":
				return { type: "COMMAND_OUTPUT_STREAMING", commandId: "unknown", canSendInput: true }
			case "api_req_failed":
				return { type: "API_REQUEST_FAILED", canRetry: true, errorMessage: lastMessage.text || "Unknown error" }
		}
	}
	if (lastMessage.partial) {
		return { type: "STREAMING_RESPONSE", partial: true }
	}
	return { type: "IDLE" }
}
