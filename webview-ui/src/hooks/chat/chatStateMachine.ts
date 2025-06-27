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
	console.log("[ChatStateMachine] Current state:", state.type, "Event:", event.type, "Event data:", event)

	// Handle INITIALIZE event regardless of current state
	if (event.type === "INITIALIZE" && "state" in event) {
		console.log("[ChatStateMachine] Initializing to state:", event.state)
		return { state: event.state, effects: [] }
	}

	// Check if we're in NO_TASK state to determine if we should create a task
	const shouldCreateTask =
		state.type === "NO_TASK" || (state.type === "COMPOSING" && "wasNoTask" in state && state.wasNoTask === true)

	switch (state.type) {
		case "NO_TASK":
			if (event.type === "INPUT_CHANGED") {
				if (hasContent(event)) {
					console.log("[ChatStateMachine] NO_TASK -> COMPOSING (for new task)")
					return {
						state: {
							type: "COMPOSING",
							content: event.content || "",
							images: event.images || [],
							files: event.files || [],
							wasNoTask: true, // Mark that we came from NO_TASK
						} as any, // Type assertion needed for the extra property
						effects: [],
					}
				}
			}
			if (event.type === "SEND_CLICKED") {
				console.log("[ChatStateMachine] NO_TASK SEND_CLICKED - this shouldn't happen")
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
					// Check if we should go back to NO_TASK or IDLE
					const wasNoTask = "wasNoTask" in state && state.wasNoTask
					return { state: wasNoTask ? { type: "NO_TASK" } : { type: "IDLE" }, effects: [] }
				}
				return {
					state: { ...state, content: event.content || "", images: event.images || [], files: event.files || [] },
					effects: [],
				}
			}
			if (event.type === "SEND_CLICKED") {
				console.log("[ChatStateMachine] COMPOSING -> SEND_CLICKED")
				// Check if we should create a task or send a message
				const wasNoTask = "wasNoTask" in state && state.wasNoTask
				if (wasNoTask) {
					console.log("[ChatStateMachine] Creating new task")
					return {
						state: { type: "CREATING_TASK", content: state.content, images: state.images, files: state.files },
						effects: [{ type: "CREATE_TASK", content: state.content, images: state.images, files: state.files }],
					}
				} else {
					console.log("[ChatStateMachine] Sending message")
					return {
						state: { type: "SENDING_MESSAGE", content: state.content, images: state.images, files: state.files },
						effects: [{ type: "SEND_MESSAGE", content: state.content, images: state.images, files: state.files }],
					}
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

	console.log("[ChatStateMachine] No state transition for:", state.type, "with event:", event.type)
	console.log("[ChatStateMachine] Returning unchanged state:", state)
	return { state, effects }
}
