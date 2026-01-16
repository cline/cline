/**
 * Task-related type definitions
 */

/**
 * Task status
 */
export type TaskStatus = "active" | "paused" | "completed"

/**
 * Task mode (plan or act)
 */
export type TaskMode = "plan" | "act"

/**
 * Task information stored in task history
 */
export interface TaskInfo {
	/** Unique task identifier */
	id: string
	/** The initial prompt/task description */
	prompt: string
	/** Creation timestamp (Unix epoch ms) */
	createdAt: number
	/** Last updated timestamp (Unix epoch ms) */
	updatedAt: number
	/** Current task status */
	status: TaskStatus
	/** Current mode (plan or act) */
	mode: TaskMode
	/** Number of messages in the conversation */
	messageCount: number
	/** Working directory for the task */
	workingDirectory?: string
	/** Custom settings overrides */
	settings?: Record<string, string>
}

/**
 * Task creation options
 */
export interface TaskCreateOptions {
	/** Initial prompt */
	prompt: string
	/** Starting mode */
	mode?: TaskMode
	/** Enable autonomous/yolo mode */
	noInteractive?: boolean
	/** Custom settings overrides */
	settings?: Record<string, string>
	/** Working directory */
	workingDirectory?: string
}

/**
 * Task open options
 */
export interface TaskOpenOptions {
	/** Override mode */
	mode?: TaskMode
	/** Enable autonomous/yolo mode */
	noInteractive?: boolean
	/** Custom settings overrides */
	settings?: Record<string, string>
}

/**
 * Task list item for display purposes
 */
export interface TaskListItem {
	/** Task ID (possibly truncated for display) */
	id: string
	/** Full task ID */
	fullId: string
	/** Prompt snippet (truncated) */
	promptSnippet: string
	/** Full prompt */
	prompt: string
	/** Task status */
	status: TaskStatus
	/** Task mode */
	mode: TaskMode
	/** Relative time string (e.g., "2 hours ago") */
	timeAgo: string
	/** Creation timestamp */
	createdAt: number
}

/**
 * Message role (who sent the message)
 */
export type MessageRole = "user" | "assistant" | "system"

/**
 * Message type for categorization
 */
export type MessageType = "text" | "command" | "error" | "tool_use" | "tool_result" | "approval_request" | "approval_response"

/**
 * A single message in a task conversation
 */
export interface TaskMessage {
	/** Unique message ID */
	id: string
	/** Task ID this message belongs to */
	taskId: string
	/** Who sent the message */
	role: MessageRole
	/** Message type */
	type: MessageType
	/** Message content */
	content: string
	/** Timestamp (Unix epoch ms) */
	timestamp: number
	/** Optional file attachments (paths) */
	attachments?: string[]
	/** Optional metadata */
	metadata?: Record<string, unknown>
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
	/** Approve a proposed action */
	approve?: boolean
	/** Deny a proposed action */
	deny?: boolean
	/** Attach file(s) */
	files?: string[]
	/** Enable autonomous mode */
	noInteractive?: boolean
	/** Switch to mode */
	mode?: TaskMode
}
