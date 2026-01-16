/**
 * Task storage and management system
 * Stores task history in ~/.cline/tasks/
 */

import crypto from "crypto"
import fs from "fs"
import path from "path"
import type {
	MessageRole,
	MessageType,
	TaskCreateOptions,
	TaskInfo,
	TaskListItem,
	TaskMessage,
	TaskMode,
	TaskStatus,
} from "../types/task.js"
import { getDefaultConfigDir } from "./config.js"

/**
 * Generate a short unique task ID
 */
function generateTaskId(): string {
	return crypto.randomBytes(8).toString("hex")
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str
	}
	return str.slice(0, maxLength - 3) + "..."
}

/**
 * Get relative time string (e.g., "2 hours ago")
 */
function getTimeAgo(timestamp: number): string {
	const now = Date.now()
	const diff = now - timestamp
	const seconds = Math.floor(diff / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)
	const weeks = Math.floor(days / 7)
	const months = Math.floor(days / 30)

	if (months > 0) {
		return months === 1 ? "1 month ago" : `${months} months ago`
	}
	if (weeks > 0) {
		return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`
	}
	if (days > 0) {
		return days === 1 ? "1 day ago" : `${days} days ago`
	}
	if (hours > 0) {
		return hours === 1 ? "1 hour ago" : `${hours} hours ago`
	}
	if (minutes > 0) {
		return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
	}
	return "just now"
}

/**
 * Task storage class
 */
export class TaskStorage {
	private tasksDir: string
	private indexPath: string

	constructor(configDir?: string) {
		const baseDir = configDir || getDefaultConfigDir()
		this.tasksDir = path.join(baseDir, "tasks")
		this.indexPath = path.join(this.tasksDir, "index.json")
	}

	/**
	 * Ensure the tasks directory exists
	 */
	private ensureTasksDir(): void {
		if (!fs.existsSync(this.tasksDir)) {
			fs.mkdirSync(this.tasksDir, { recursive: true, mode: 0o700 })
		}
	}

	/**
	 * Get path to a task file
	 */
	private getTaskPath(taskId: string): string {
		return path.join(this.tasksDir, `${taskId}.json`)
	}

	/**
	 * Load the task index (list of all task IDs and metadata)
	 */
	private loadIndex(): TaskInfo[] {
		try {
			if (fs.existsSync(this.indexPath)) {
				const content = fs.readFileSync(this.indexPath, "utf-8")
				return JSON.parse(content) as TaskInfo[]
			}
		} catch {
			// Return empty index on error
		}
		return []
	}

	/**
	 * Save the task index
	 */
	private saveIndex(index: TaskInfo[]): void {
		this.ensureTasksDir()
		fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), {
			mode: 0o600,
		})
	}

	/**
	 * Create a new task
	 */
	create(options: TaskCreateOptions): TaskInfo {
		const now = Date.now()
		const taskInfo: TaskInfo = {
			id: generateTaskId(),
			prompt: options.prompt,
			createdAt: now,
			updatedAt: now,
			status: "active",
			mode: options.mode || "act",
			messageCount: 0,
			workingDirectory: options.workingDirectory || process.cwd(),
			settings: options.settings,
		}

		// Save task file
		this.ensureTasksDir()
		fs.writeFileSync(this.getTaskPath(taskInfo.id), JSON.stringify(taskInfo, null, 2), {
			mode: 0o600,
		})

		// Update index
		const index = this.loadIndex()
		index.unshift(taskInfo) // Add to beginning (most recent first)
		this.saveIndex(index)

		return taskInfo
	}

	/**
	 * Get a task by ID
	 */
	get(taskId: string): TaskInfo | null {
		const taskPath = this.getTaskPath(taskId)
		try {
			if (fs.existsSync(taskPath)) {
				const content = fs.readFileSync(taskPath, "utf-8")
				return JSON.parse(content) as TaskInfo
			}
		} catch {
			// Return null on error
		}

		// Try to find by partial ID
		const index = this.loadIndex()
		const match = index.find((t) => t.id.startsWith(taskId))
		if (match) {
			return this.get(match.id)
		}

		return null
	}

	/**
	 * Update a task
	 */
	update(taskId: string, updates: Partial<TaskInfo>): TaskInfo | null {
		const task = this.get(taskId)
		if (!task) {
			return null
		}

		const updatedTask: TaskInfo = {
			...task,
			...updates,
			id: task.id, // Ensure ID doesn't change
			updatedAt: Date.now(),
		}

		// Save task file
		fs.writeFileSync(this.getTaskPath(task.id), JSON.stringify(updatedTask, null, 2), {
			mode: 0o600,
		})

		// Update index
		const index = this.loadIndex()
		const indexPos = index.findIndex((t) => t.id === task.id)
		if (indexPos >= 0) {
			index[indexPos] = updatedTask
			this.saveIndex(index)
		}

		return updatedTask
	}

	/**
	 * Update task status
	 */
	updateStatus(taskId: string, status: TaskStatus): TaskInfo | null {
		return this.update(taskId, { status })
	}

	/**
	 * Update task mode
	 */
	updateMode(taskId: string, mode: TaskMode): TaskInfo | null {
		return this.update(taskId, { mode })
	}

	/**
	 * Increment message count
	 */
	incrementMessageCount(taskId: string): TaskInfo | null {
		const task = this.get(taskId)
		if (!task) {
			return null
		}
		return this.update(taskId, { messageCount: task.messageCount + 1 })
	}

	/**
	 * Delete a task
	 */
	delete(taskId: string): boolean {
		const task = this.get(taskId)
		if (!task) {
			return false
		}

		// Delete task file
		const taskPath = this.getTaskPath(task.id)
		if (fs.existsSync(taskPath)) {
			fs.unlinkSync(taskPath)
		}

		// Update index
		const index = this.loadIndex()
		const filteredIndex = index.filter((t) => t.id !== task.id)
		this.saveIndex(filteredIndex)

		return true
	}

	/**
	 * List all tasks
	 */
	list(limit?: number): TaskInfo[] {
		const index = this.loadIndex()
		if (limit) {
			return index.slice(0, limit)
		}
		return index
	}

	/**
	 * List tasks formatted for display
	 */
	listForDisplay(limit?: number, idLength = 8, promptLength = 50): TaskListItem[] {
		const tasks = this.list(limit)
		return tasks.map((task) => ({
			id: task.id.slice(0, idLength),
			fullId: task.id,
			promptSnippet: truncate(task.prompt.replace(/\n/g, " "), promptLength),
			prompt: task.prompt,
			status: task.status,
			mode: task.mode,
			timeAgo: getTimeAgo(task.createdAt),
			createdAt: task.createdAt,
		}))
	}

	/**
	 * Find task by partial ID
	 */
	findByPartialId(partialId: string): TaskInfo | null {
		const index = this.loadIndex()
		const matches = index.filter((t) => t.id.startsWith(partialId))
		if (matches.length === 1) {
			return this.get(matches[0].id)
		}
		if (matches.length > 1) {
			// Return the most recent match
			return this.get(matches[0].id)
		}
		return null
	}

	/**
	 * Get the tasks directory path
	 */
	getTasksDir(): string {
		return this.tasksDir
	}

	/**
	 * Clear all tasks (for testing)
	 */
	clear(): void {
		const tasks = this.list()
		for (const task of tasks) {
			this.delete(task.id)
		}
	}

	// ========== Message Storage Methods ==========

	/**
	 * Get path to a task's messages file
	 */
	private getMessagesPath(taskId: string): string {
		return path.join(this.tasksDir, `${taskId}-messages.json`)
	}

	/**
	 * Load messages for a task
	 */
	private loadMessages(taskId: string): TaskMessage[] {
		const messagesPath = this.getMessagesPath(taskId)
		try {
			if (fs.existsSync(messagesPath)) {
				const content = fs.readFileSync(messagesPath, "utf-8")
				return JSON.parse(content) as TaskMessage[]
			}
		} catch {
			// Return empty array on error
		}
		return []
	}

	/**
	 * Save messages for a task
	 */
	private saveMessages(taskId: string, messages: TaskMessage[]): void {
		this.ensureTasksDir()
		fs.writeFileSync(this.getMessagesPath(taskId), JSON.stringify(messages, null, 2), {
			mode: 0o600,
		})
	}

	/**
	 * Add a message to a task
	 */
	addMessage(
		taskId: string,
		role: MessageRole,
		type: MessageType,
		content: string,
		attachments?: string[],
		metadata?: Record<string, unknown>,
	): TaskMessage | null {
		const task = this.get(taskId)
		if (!task) {
			return null
		}

		const message: TaskMessage = {
			id: crypto.randomBytes(8).toString("hex"),
			taskId: task.id,
			role,
			type,
			content,
			timestamp: Date.now(),
			attachments,
			metadata,
		}

		// Load existing messages and append
		const messages = this.loadMessages(task.id)
		messages.push(message)
		this.saveMessages(task.id, messages)

		// Update message count on task
		this.incrementMessageCount(task.id)

		return message
	}

	/**
	 * Get all messages for a task
	 */
	getMessages(taskId: string): TaskMessage[] {
		const task = this.get(taskId)
		if (!task) {
			return []
		}
		return this.loadMessages(task.id)
	}

	/**
	 * Get the latest message for a task
	 */
	getLatestMessage(taskId: string): TaskMessage | null {
		const messages = this.getMessages(taskId)
		if (messages.length === 0) {
			return null
		}
		return messages[messages.length - 1]
	}

	/**
	 * Get messages since a given timestamp
	 */
	getMessagesSince(taskId: string, sinceTimestamp: number): TaskMessage[] {
		const messages = this.getMessages(taskId)
		return messages.filter((m) => m.timestamp > sinceTimestamp)
	}

	/**
	 * Check if task has pending approval request
	 */
	hasPendingApproval(taskId: string): TaskMessage | null {
		const messages = this.getMessages(taskId)
		// Look for the last message that's an approval request without a response
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg.type === "approval_request") {
				// Check if there's a response after this
				const hasResponse = messages.slice(i + 1).some((m) => m.type === "approval_response")
				if (!hasResponse) {
					return msg
				}
			}
		}
		return null
	}

	/**
	 * Clear messages for a task (for testing)
	 */
	clearMessages(taskId: string): void {
		const task = this.get(taskId)
		if (task) {
			const messagesPath = this.getMessagesPath(task.id)
			if (fs.existsSync(messagesPath)) {
				fs.unlinkSync(messagesPath)
			}
			this.update(task.id, { messageCount: 0 })
		}
	}
}

/**
 * Create a task storage instance
 */
export function createTaskStorage(configDir?: string): TaskStorage {
	return new TaskStorage(configDir)
}
