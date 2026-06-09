import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { EventEmitter } from "events"
import Mutex from "p-mutex"
import { ClineMessage } from "@/shared/ExtensionMessage"
import { HistoryItem } from "@/shared/HistoryItem"
import { ClineStorageMessage } from "@/shared/messages/content"
import { TaskState } from "./TaskState"

// Event types for clineMessages changes
export type ClineMessageChangeType = "add" | "update" | "delete" | "set"

export interface ClineMessageChange {
	type: ClineMessageChangeType
	/** The full array after the change */
	messages: ClineMessage[]
	/** The affected index (for add/update/delete) */
	index?: number
	/** The new/updated message (for add/update) */
	message?: ClineMessage
	/** The old message before change (for update/delete) */
	previousMessage?: ClineMessage
	/** The entire previous array (for set) */
	previousMessages?: ClineMessage[]
}

// Strongly-typed event emitter interface
export interface MessageStateHandlerEvents {
	clineMessagesChanged: [change: ClineMessageChange]
}

interface MessageStateHandlerParams {
	taskId: string
	ulid: string
	taskIsFavorited?: boolean
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	taskState: TaskState
	checkpointManagerErrorMessage?: string
}

export class MessageStateHandler extends EventEmitter<MessageStateHandlerEvents> {
	private apiConversationHistory: ClineStorageMessage[] = []
	private clineMessages: ClineMessage[] = []
	private taskId: string
	private taskState: TaskState

	// Mutex to prevent concurrent state modifications (RC-4)
	// Protects against data loss from race conditions when multiple
	// operations try to modify message state simultaneously
	// This follows the same pattern as Task.stateMutex for consistency
	private stateMutex = new Mutex()

	constructor(params: MessageStateHandlerParams) {
		super()
		this.taskId = params.taskId
		this.taskState = params.taskState
	}

	/**
	 * Emit a clineMessagesChanged event with the change details
	 */
	private emitClineMessagesChanged(change: ClineMessageChange): void {
		this.emit("clineMessagesChanged", change)
	}

	setCheckpointTracker(_tracker: CheckpointTracker | undefined) {}

	/**
	 * Execute function with exclusive lock on message state
	 * Use this for ANY state modification to prevent race conditions
	 * This follows the same pattern as Task.withStateLock for consistency
	 */
	private async withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn)
	}

	getApiConversationHistory(): ClineStorageMessage[] {
		return this.apiConversationHistory
	}

	setApiConversationHistory(newHistory: ClineStorageMessage[]): void {
		this.apiConversationHistory = newHistory
	}

	getClineMessages(): ClineMessage[] {
		return this.clineMessages
	}

	setClineMessages(newMessages: ClineMessage[]) {
		const previousMessages = this.clineMessages
		this.clineMessages = newMessages
		this.emitClineMessagesChanged({
			type: "set",
			messages: this.clineMessages,
			previousMessages,
		})
	}

	/**
	 * Save cline messages and update task history (public API with mutex protection)
	 * This is the main entry point for saving message state from external callers
	 */
	async saveClineMessagesAndUpdateHistory(): Promise<void> {}

	async addToApiConversationHistory(message: ClineStorageMessage) {
		// Protect with mutex to prevent concurrent modifications from corrupting data (RC-4)
		return await this.withStateLock(async () => {
			this.apiConversationHistory.push(message)
		})
	}

	async overwriteApiConversationHistory(newHistory: ClineStorageMessage[]): Promise<void> {
		// Protect with mutex to prevent concurrent modifications from corrupting data (RC-4)
		return await this.withStateLock(async () => {
			this.apiConversationHistory = newHistory
		})
	}

	/**
	 * Add a new message to clineMessages array with proper index tracking
	 * CRITICAL: This entire operation must be atomic to prevent race conditions (RC-4)
	 * The conversationHistoryIndex must be set correctly based on the current state,
	 * and the message must be added and saved without any interleaving operations
	 */
	async addToClineMessages(message: ClineMessage) {
		return await this.withStateLock(async () => {
			// these values allow us to reconstruct the conversation history at the time this cline message was created
			// it's important that apiConversationHistory is initialized before we add cline messages
			message.conversationHistoryIndex = this.apiConversationHistory.length - 1 // NOTE: this is the index of the last added message which is the user message, and once the clinemessages have been presented we update the apiconversationhistory with the completed assistant message. This means when resetting to a message, we need to +1 this index to get the correct assistant message that this tool use corresponds to
			message.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange
			const index = this.clineMessages.length
			this.clineMessages.push(message)
			this.emitClineMessagesChanged({
				type: "add",
				messages: this.clineMessages,
				index,
				message,
			})
		})
	}

	/**
	 * Replace the entire clineMessages array with new messages
	 * Protected by mutex to prevent concurrent modifications (RC-4)
	 */
	async overwriteClineMessages(newMessages: ClineMessage[]) {
		return await this.withStateLock(async () => {
			const previousMessages = this.clineMessages
			this.clineMessages = newMessages
			this.emitClineMessagesChanged({
				type: "set",
				messages: this.clineMessages,
				previousMessages,
			})
		})
	}

	/**
	 * Update a specific message in the clineMessages array
	 * The entire operation (validate, update, save) is atomic to prevent races (RC-4)
	 */
	async updateClineMessage(index: number, updates: Partial<ClineMessage>): Promise<void> {
		return await this.withStateLock(async () => {
			if (index < 0 || index >= this.clineMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			// Capture previous state before mutation
			const previousMessage = { ...this.clineMessages[index] }

			// Apply updates to the message
			Object.assign(this.clineMessages[index], updates)

			this.emitClineMessagesChanged({
				type: "update",
				messages: this.clineMessages,
				index,
				previousMessage,
				message: this.clineMessages[index],
			})

			// Save changes and update history
		})
	}

	/**
	 * Delete a specific message from the clineMessages array
	 * The entire operation (validate, delete, save) is atomic to prevent races (RC-4)
	 */
	async deleteClineMessage(index: number): Promise<void> {
		return await this.withStateLock(async () => {
			if (index < 0 || index >= this.clineMessages.length) {
				throw new Error(`Invalid message index: ${index}`)
			}

			// Capture the message before deletion
			const previousMessage = this.clineMessages[index]

			// Remove the message at the specified index
			this.clineMessages.splice(index, 1)

			this.emitClineMessagesChanged({
				type: "delete",
				messages: this.clineMessages,
				index,
				previousMessage,
			})

			// Save changes and update history
		})
	}
}
