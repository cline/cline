/**
 * Represents an active background command that can be cancelled
 */
export interface ActiveBackgroundCommand {
	process: {
		terminate?: () => void
		continue?: () => void
	}
	command: string
	outputLines: string[]
}

/**
 * Response from an ask() call
 */
export interface AskResponse {
	response: string // "yesButtonClicked" | "noButtonClicked" | "messageResponse"
	text?: string
	images?: string[]
	files?: string[]
}

/**
 * Callbacks for CommandExecutor to interact with Task state
 * These are bound methods from the Task class that allow CommandExecutor
 * to update UI and state without owning that state directly.
 */
export interface CommandExecutorCallbacks {
	/** Display a message in the chat UI (non-blocking) */
	say: (type: string, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<number | undefined>
	/**
	 * Ask the user a question and wait for response (blocking)
	 * This is used for "Proceed While Running" flow where we need to wait for user input
	 */
	ask: (type: string, text?: string, partial?: boolean) => Promise<AskResponse>
	/** Update the background command running state in the controller */
	updateBackgroundCommandState: (running: boolean) => void
	/** Update a cline message by index */
	updateClineMessage: (index: number, updates: { commandCompleted?: boolean }) => Promise<void>
	/** Get cline messages array */
	getClineMessages: () => Array<{ ask?: string; say?: string }>
	/** Add content to user message for next API request */
	addToUserMessageContent: (content: { type: string; text: string }) => void
}

/**
 * Base configuration for CommandExecutor
 */
export interface CommandExecutorConfig {
	terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	cwd: string
	taskId: string
	ulid: string
}
