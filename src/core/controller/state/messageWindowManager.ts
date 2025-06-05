import { ClineMessage } from "@shared/ExtensionMessage"

export interface MessageWindow {
	messages: ClineMessage[]
	totalCount: number
	windowStart: number
	windowSize: number
}

export class MessageWindowManager {
	private static readonly DEFAULT_WINDOW_SIZE = 100
	private static readonly MAX_MEMORY_MESSAGES = 200

	private allMessages: ClineMessage[] = []
	private windowStart: number = 0
	private windowSize: number = MessageWindowManager.DEFAULT_WINDOW_SIZE

	constructor(windowSize: number = MessageWindowManager.DEFAULT_WINDOW_SIZE) {
		this.windowSize = Math.min(windowSize, MessageWindowManager.MAX_MEMORY_MESSAGES)
	}

	/**
	 * Add new messages and maintain window
	 */
	addMessages(messages: ClineMessage[]): void {
		this.allMessages.push(...messages)

		// If we exceed max memory limit, trim old messages
		if (this.allMessages.length > MessageWindowManager.MAX_MEMORY_MESSAGES * 2) {
			// Keep the most recent messages
			const trimStart = this.allMessages.length - MessageWindowManager.MAX_MEMORY_MESSAGES
			this.allMessages = this.allMessages.slice(trimStart)

			// Adjust window start if needed
			if (this.windowStart > 0) {
				this.windowStart = Math.max(0, this.windowStart - trimStart)
			}
		}
	}

	/**
	 * Get current window of messages
	 */
	getCurrentWindow(): MessageWindow {
		const start = Math.max(0, this.allMessages.length - this.windowSize)
		const windowMessages = this.allMessages.slice(start)

		return {
			messages: windowMessages,
			totalCount: this.allMessages.length,
			windowStart: start,
			windowSize: windowMessages.length,
		}
	}

	/**
	 * Get messages for a specific range
	 */
	getMessageRange(start: number, count: number): ClineMessage[] {
		const end = Math.min(start + count, this.allMessages.length)
		return this.allMessages.slice(start, end)
	}

	/**
	 * Update a specific message (for partial updates)
	 */
	updateMessage(index: number, message: ClineMessage): void {
		if (index >= 0 && index < this.allMessages.length) {
			this.allMessages[index] = message
		}
	}

	/**
	 * Clear all messages
	 */
	clear(): void {
		this.allMessages = []
		this.windowStart = 0
	}

	/**
	 * Get memory statistics
	 */
	getMemoryStats(): {
		totalMessages: number
		messagesInMemory: number
		estimatedMemoryMB: number
	} {
		const avgMessageSize = 1024 // Assume 1KB average per message
		const estimatedMemoryBytes = this.allMessages.length * avgMessageSize

		return {
			totalMessages: this.allMessages.length,
			messagesInMemory: this.allMessages.length,
			estimatedMemoryMB: estimatedMemoryBytes / (1024 * 1024),
		}
	}

	/**
	 * Archive old messages (for future disk storage implementation)
	 */
	async archiveOldMessages(keepCount: number = 100): Promise<number> {
		if (this.allMessages.length <= keepCount) {
			return 0
		}

		const toArchive = this.allMessages.slice(0, -keepCount)
		// TODO: Implement disk storage for archived messages

		// For now, just remove them from memory
		this.allMessages = this.allMessages.slice(-keepCount)

		return toArchive.length
	}
}

// Global instance for the current task
let currentMessageWindow: MessageWindowManager | null = null

export function getMessageWindowManager(): MessageWindowManager {
	if (!currentMessageWindow) {
		currentMessageWindow = new MessageWindowManager()
	}
	return currentMessageWindow
}

export function resetMessageWindowManager(): void {
	currentMessageWindow = null
}
