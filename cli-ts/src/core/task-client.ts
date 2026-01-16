/**
 * Task storage and management system
 * Stores task history in ~/.cline/tasks/
 */

import crypto from "crypto"
import fs from "fs"
import path from "path"
import type { TaskCreateOptions, TaskInfo, TaskListItem, TaskMode, TaskStatus } from "../types/task.js"
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
}

/**
 * Create a task storage instance
 */
export function createTaskStorage(configDir?: string): TaskStorage {
	return new TaskStorage(configDir)
}
