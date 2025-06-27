import { ChatEvent, ChatState } from "./chatStateTypes"
import { ClineMessage } from "@shared/ExtensionMessage"

function hasContent(event: { content?: string; images?: string[]; files?: string[] }): boolean {
	return !!(event.content?.trim() || (event.images && event.images.length > 0) || (event.files && event.files.length > 0))
}

function deriveStateFromMessage(message: ClineMessage): ChatState {
	if (message.type === "ask") {
		switch (message.ask) {
			case "tool":
				return { type: "AWAITING_TOOL_APPROVAL", tool: { name: "unknown" }, canProvideInput: true }
			case "command":
				return { type: "AWAITING_COMMAND_APPROVAL", command: message.text || "", canProvideInput: true }
			case "command_output":
				return { type: "COMMAND_OUTPUT_STREAMING", commandId: "unknown", canSendInput: true }
			case "api_req_failed":
				return { type: "API_REQUEST_FAILED", canRetry: true, errorMessage: message.text || "Unknown error" }
			// Add other cases from the original logic
		}
	}
	if (message.partial) {
		return { type: "STREAMING_RESPONSE", partial: true }
	}
	return { type: "IDLE" }
}

export function chatStateReducer(
	{ state, effects }: { state: ChatState; effects?: any[] },
	event: ChatEvent,
): { state: ChatState; effects?: any[] } {
	switch (state.type) {
		case "NO_TASK":
			if (event.type === "INPUT_CHANGED") {
				if (hasContent(event)) {
					return {
						state: {
							type: "COMPOSING",
							content: event.content || "",
							images: event.images || [],
							files: event.files || [],
						},
					}
				}
			}
			if (event.type === "SEND_CLICKED") {
				// This case is handled by the COMPOSING state, but as a safeguard:
				return { state, effects }
			}
			break

		case "IDLE":
			if (event.type === "INPUT_CHANGED") {
				return {
					state: hasContent(event)
						? {
								type: "COMPOSING",
								content: event.content || "",
								images: event.images || [],
								files: event.files || [],
							}
						: { type: "IDLE" },
				}
			}
			if (event.type === "MESSAGE_RECEIVED") {
				return { state: deriveStateFromMessage(event.message) }
			}
			if (event.type === "MODE_TOGGLE_CLICKED") {
				return { state: { type: "TOGGLING_MODE", previousState: state } }
			}
			break

		case "COMPOSING":
			if (event.type === "INPUT_CHANGED") {
				if (!hasContent(event)) {
					return { state: { type: "IDLE" } }
				}
				return { state: { ...state, content: event.content || "", images: event.images || [], files: event.files || [] } }
			}
			if (event.type === "SEND_CLICKED") {
				return {
					state: { type: "SENDING_MESSAGE", content: state.content, images: state.images, files: state.files },
					effects: [{ type: "SEND_MESSAGE", content: state.content, images: state.images, files: state.files }],
				}
			}
			if (event.type === "MODE_TOGGLE_CLICKED") {
				return {
					state: { type: "TOGGLING_MODE", previousState: state },
					effects: [
						{ type: "TOGGLE_MODE_WITH_CONTENT", content: state.content, images: state.images, files: state.files },
					],
				}
			}
			break

		// TODO: Implement other state transitions
	}
	return { state, effects }
}
