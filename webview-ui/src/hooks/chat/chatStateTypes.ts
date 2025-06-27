import { ClineMessage } from "@shared/ExtensionMessage"

export type ToolInfo = {
	name: string
	// Add other relevant tool details if needed
}

export type ChatState =
	// No task states
	| { type: "NO_TASK" }
	| { type: "CREATING_TASK"; content: string; images: string[]; files: string[] }

	// Normal conversation states
	| { type: "IDLE" }
	| { type: "COMPOSING"; content: string; images: string[]; files: string[] }
	| { type: "SENDING_MESSAGE"; content: string; images: string[]; files: string[] }
	| { type: "SENDING_MESSAGE" }
	| { type: "STREAMING_RESPONSE"; partial: boolean }

	// Approval states
	| { type: "AWAITING_TOOL_APPROVAL"; tool: ToolInfo; canProvideInput: boolean }
	| { type: "AWAITING_COMMAND_APPROVAL"; command: string; canProvideInput: boolean }
	| { type: "AWAITING_BROWSER_APPROVAL"; action: string }
	| { type: "AWAITING_MCP_APPROVAL"; server: string }

	// Special interaction states
	| { type: "COMMAND_OUTPUT_STREAMING"; commandId: string; canSendInput: true }
	| { type: "API_REQUEST_FAILED"; canRetry: boolean; errorMessage: string }
	| { type: "MISTAKE_LIMIT_REACHED" }
	| { type: "AUTO_APPROVAL_LIMIT_REACHED" }

	// Task completion states
	| { type: "TASK_COMPLETED"; canProvideFeedback: boolean }
	| { type: "RESUMING_TASK" }
	| { type: "RESUMING_COMPLETED_TASK" }

	// Mode switching
	| { type: "TOGGLING_MODE"; previousState: ChatState }

	// Special actions
	| { type: "CREATING_NEW_TASK_WITH_CONTEXT" }
	| { type: "CONDENSING_CONVERSATION" }
	| { type: "REPORTING_BUG" }

export type ChatEvent =
	| { type: "INITIALIZE"; state: ChatState }
	| { type: "INPUT_CHANGED"; content: string; images?: string[]; files?: string[] }
	| { type: "SEND_CLICKED" }
	| { type: "MESSAGE_RECEIVED"; message: ClineMessage }
	| { type: "MODE_TOGGLE_CLICKED" }
	| { type: "PRIMARY_BUTTON_CLICKED"; input?: string }
	| { type: "SECONDARY_BUTTON_CLICKED"; input?: string }
	| { type: "SEND_FAILED"; error: Error }

export interface ChatStateContext {
	// UI State
	inputValue: string
	selectedImages: string[]
	selectedFiles: string[]
	activeQuote: string | null

	// Derived State
	sendingDisabled: boolean
	enableButtons: boolean
	primaryButtonText?: string
	secondaryButtonText?: string
	placeholderText: string

	// Behavior flags
	shouldClearInputOnSend: boolean
	shouldFocusInput: boolean
	canToggleMode: boolean
}
