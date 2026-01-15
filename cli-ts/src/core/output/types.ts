/**
 * Output formatting types for the CLI
 */

/**
 * Supported output formats
 */
export type OutputFormat = "rich" | "json" | "plain"

/**
 * Cline message structure matching the extension's message format
 */
export interface ClineMessage {
	/** Message type - ask requires user response, say is informational */
	type: "ask" | "say"
	/** Message text content */
	text?: string
	/** Unix epoch milliseconds timestamp */
	ts: number
	/** AI reasoning/thinking content */
	reasoning?: string
	/** Say message subtype */
	say?:
		| "text"
		| "user_feedback"
		| "user_feedback_diff"
		| "error"
		| "completion_result"
		| "tool"
		| "command"
		| "command_output"
		| "api_req_started"
		| "api_req_finished"
		| "api_req_retried"
	/** Ask message subtype */
	ask?:
		| "followup"
		| "command"
		| "command_output"
		| "completion_result"
		| "tool"
		| "api_req_failed"
		| "resume_task"
		| "resume_completed_task"
		| "mistake_limit_reached"
		| "auto_approval_max_req_reached"
	/** Whether this is a partial/streaming message */
	partial?: boolean
	/** Attached image paths */
	images?: string[]
	/** Attached file paths */
	files?: string[]
	/** Last checkpoint hash for restore operations */
	lastCheckpointHash?: string
	/** Whether a checkpoint is currently checked out */
	isCheckpointCheckedOut?: boolean
	/** Whether operation is outside workspace */
	isOperationOutsideWorkspace?: boolean
}

/**
 * Task information for list/display operations
 */
export interface TaskInfo {
	/** Unique task identifier */
	id: string
	/** Task creation timestamp */
	ts: number
	/** Initial task prompt/description */
	task: string
	/** Total tokens used in task */
	totalTokens?: number
	/** Total cost of task */
	totalCost?: number
	/** Whether task is completed */
	completed?: boolean
}

/**
 * Output formatter interface - all formatters must implement this
 */
export interface OutputFormatter {
	/** Format and output a Cline message */
	message(msg: ClineMessage): void

	/** Format and output an error */
	error(err: Error | string): void

	/** Format and output a success message */
	success(text: string): void

	/** Format and output a warning */
	warn(text: string): void

	/** Format and output an info message */
	info(text: string): void

	/** Format and output tabular data */
	table(data: Record<string, unknown>[], columns?: string[]): void

	/** Format and output a list of items */
	list(items: string[]): void

	/** Format and output a task list */
	tasks(tasks: TaskInfo[]): void

	/** Format and output key-value pairs */
	keyValue(data: Record<string, unknown>): void

	/** Output raw text without formatting */
	raw(text: string): void
}
