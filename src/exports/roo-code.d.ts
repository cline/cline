export interface RooCodeAPI {
	/**
	 * Sets the custom instructions in the global storage.
	 * @param value The custom instructions to be saved.
	 */
	setCustomInstructions(value: string): Promise<void>

	/**
	 * Retrieves the custom instructions from the global storage.
	 * @returns The saved custom instructions, or undefined if not set.
	 */
	getCustomInstructions(): Promise<string | undefined>

	/**
	 * Starts a new task with an optional initial message and images.
	 * @param task Optional initial task message.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 */
	startNewTask(task?: string, images?: string[]): Promise<void>

	/**
	 * Sends a message to the current task.
	 * @param message Optional message to send.
	 * @param images Optional array of image data URIs (e.g., "data:image/webp;base64,...").
	 */
	sendMessage(message?: string, images?: string[]): Promise<void>

	/**
	 * Simulates pressing the primary button in the chat interface.
	 */
	pressPrimaryButton(): Promise<void>

	/**
	 * Simulates pressing the secondary button in the chat interface.
	 */
	pressSecondaryButton(): Promise<void>

	/**
	 * The sidebar provider instance.
	 */
	sidebarProvider: ClineProvider
}

export type ClineAsk =
	| "followup"
	| "command"
	| "command_output"
	| "completion_result"
	| "tool"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "mistake_limit_reached"
	| "browser_action_launch"
	| "use_mcp_server"
	| "finishTask"

export type ClineSay =
	| "task"
	| "error"
	| "api_req_started"
	| "api_req_finished"
	| "api_req_retried"
	| "api_req_retry_delayed"
	| "api_req_deleted"
	| "text"
	| "reasoning"
	| "completion_result"
	| "user_feedback"
	| "user_feedback_diff"
	| "command_output"
	| "tool"
	| "shell_integration_warning"
	| "browser_action"
	| "browser_action_result"
	| "command"
	| "mcp_server_request_started"
	| "mcp_server_response"
	| "new_task_started"
	| "new_task"
	| "checkpoint_saved"
	| "rooignore_error"

export interface ClineMessage {
	ts: number
	type: "ask" | "say"
	ask?: ClineAsk
	say?: ClineSay
	text?: string
	images?: string[]
	partial?: boolean
	reasoning?: string
	conversationHistoryIndex?: number
	checkpoint?: Record<string, unknown>
	progressStatus?: ToolProgressStatus
}

export interface ClineProvider {
	readonly context: vscode.ExtensionContext
	readonly viewLaunched: boolean
	readonly messages: ClineMessage[]

	/**
	 * Resolves the webview view for the provider
	 * @param webviewView The webview view or panel to resolve
	 */
	resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel): Promise<void>

	/**
	 * Initializes Cline with a task
	 */
	initClineWithTask(task?: string, images?: string[]): Promise<void>

	/**
	 * Initializes Cline with a history item
	 */
	initClineWithHistoryItem(historyItem: HistoryItem): Promise<void>

	/**
	 * Posts a message to the webview
	 */
	postMessageToWebview(message: ExtensionMessage): Promise<void>

	/**
	 * Handles mode switching
	 */
	handleModeSwitch(newMode: Mode): Promise<void>

	/**
	 * Updates custom instructions
	 */
	updateCustomInstructions(instructions?: string): Promise<void>

	/**
	 * Cancels the current task
	 */
	cancelTask(): Promise<void>

	/**
	 * Gets the current state
	 */
	getState(): Promise<any>

	/**
	 * Updates a value in the global state
	 * @param key The key to update
	 * @param value The value to set
	 */
	updateGlobalState(key: GlobalStateKey, value: any): Promise<void>

	/**
	 * Gets a value from the global state
	 * @param key The key to get
	 */
	getGlobalState(key: GlobalStateKey): Promise<any>

	/**
	 * Stores a secret value in secure storage
	 * @param key The key to store the secret under
	 * @param value The secret value to store, or undefined to remove the secret
	 */
	storeSecret(key: SecretKey, value?: string): Promise<void>

	/**
	 * Resets the state
	 */
	resetState(): Promise<void>

	/**
	 * Logs a message
	 */
	log(message: string): void

	/**
	 * Disposes of the provider
	 */
	dispose(): Promise<void>
}
