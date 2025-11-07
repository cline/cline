import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import getFolderSize from "get-folder-size"
import Mutex from "p-mutex"
import { findLastIndex } from "@/shared/array"
import { combineApiRequests } from "@/shared/combineApiRequests"
import { combineCommandSequences } from "@/shared/combineCommandSequences"
import { ClineMessage } from "@/shared/ExtensionMessage"
import { getApiMetrics } from "@/shared/getApiMetrics"
import { HistoryItem } from "@/shared/HistoryItem"
import { ClineStorageMessage } from "@/shared/messages/content"
import { getCwd, getDesktopDir } from "@/utils/path"
import { ensureTaskDirectoryExists, saveApiConversationHistory, saveClineMessages } from "../storage/disk"
import { TaskState } from "./TaskState"

interface MessageStateHandlerParams {
	taskId: string
	ulid: string
	taskIsFavorited?: boolean
	updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	taskState: TaskState
	checkpointManagerErrorMessage?: string
}

export class MessageStateHandler {
	private apiConversationHistory: ClineStorageMessage[] = []
	private clineMessages: ClineMessage[] = []
	private taskIsFavorited: boolean
	private checkpointTracker: CheckpointTracker | undefined
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private taskId: string
	private ulid: string
	private taskState: TaskState

	// Mutex to prevent concurrent state modifications (RC-4)
	// Protects against data loss from race conditions when multiple
	// operations try to modify message state simultaneously
	// This follows the same pattern as Task.stateMutex for consistency
	private stateMutex = new Mutex()

	constructor(params: MessageStateHandlerParams) {
		this.taskId = params.taskId
		this.ulid = params.ulid
		this.taskState = params.taskState
		this.taskIsFavorited = params.taskIsFavorited ?? false
		this.updateTaskHistory = params.updateTaskHistory
	}

	setCheckpointTracker(tracker: CheckpointTracker | undefined) {
		this.checkpointTracker = tracker
	}

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
		this.clineMessages = newMessages
	}

	/**
	 * Internal method to save messages and update history (without mutex protection)
	 * This is used by methods that already hold the stateMutex lock
	 * Should NOT be called directly - use saveClineMessagesAndUpdateHistory() instead
	 */
	private async saveClineMessagesAndUpdateHistoryInternal(): Promise<void> {
		try {
			await saveClineMessages(this.taskId, this.clineMessages)

			// combined as they are in ChatView
			const apiMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(this.clineMessages.slice(1))))
			const taskMessage = this.clineMessages[0] // first message is always the task say
			const lastRelevantMessage =
				this.clineMessages[
					findLastIndex(
						this.clineMessages,
						(message) => !(message.ask === "resume_task" || message.ask === "resume_completed_task"),
					)
				]
			const lastModelInfo = [...this.apiConversationHistory].reverse().find((msg) => msg.modelInfo !== undefined)
			const taskDir = await ensureTaskDirectoryExists(this.taskId)
			let taskDirSize = 0
			try {
				// getFolderSize.loose silently ignores errors
				// returns # of bytes, size/1000/1000 = MB
				taskDirSize = await getFolderSize.loose(taskDir)
			} catch (error) {
				console.error("Failed to get task directory size:", taskDir, error)
			}
			const cwd = await getCwd(getDesktopDir())
			await this.updateTaskHistory({
				id: this.taskId,
				ulid: this.ulid,
				ts: lastRelevantMessage.ts,
				task: taskMessage.text ?? "",
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites,
				cacheReads: apiMetrics.totalCacheReads,
				totalCost: apiMetrics.totalCost,
				size: taskDirSize,
				shadowGitConfigWorkTree: await this.checkpointTracker?.getShadowGitConfigWorkTree(),
				cwdOnTaskInitialization: cwd,
				conversationHistoryDeletedRange: this.taskState.conversationHistoryDeletedRange,
				isFavorited: this.taskIsFavorited,
				checkpointManagerErrorMessage: this.taskState.checkpointManagerErrorMessage,
				modelId: lastModelInfo?.modelInfo?.modelId,
			})
		} catch (error) {
			console.error("Failed to save cline messages:", error)
		}
	}

	/**
	 * Save cline messages and update task history (public API with mutex protection)
	 * This is the main entry point for saving message state from external callers
	 */
	async saveClineMessagesAndUpdateHistory(): Promise<void> {
		return await this.withStateLock(async () => {
			await this.saveClineMessagesAndUpdateHistoryInternal()
		})
	}

	async addToApiConversationHistory(message: ClineStorageMessage) {
		// Protect with mutex to prevent concurrent modifications from corrupting data (RC-4)
		return await this.withStateLock(async () => {
			this.apiConversationHistory.push(message)
			await saveApiConversationHistory(this.taskId, this.apiConversationHistory)
		})
	}

	async overwriteApiConversationHistory(newHistory: ClineStorageMessage[]): Promise<void> {
		// Protect with mutex to prevent concurrent modifications from corrupting data (RC-4)
		return await this.withStateLock(async () => {
			this.apiConversationHistory = newHistory
			await saveApiConversationHistory(this.taskId, this.apiConversationHistory)
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
			this.clineMessages.push(message)
			await this.saveClineMessagesAndUpdateHistoryInternal()
		})
	}

	/**
	 * Replace the entire clineMessages array with new messages
	 * Protected by mutex to prevent concurrent modifications (RC-4)
	 */
	async overwriteClineMessages(newMessages: ClineMessage[]) {
		return await this.withStateLock(async () => {
			this.clineMessages = newMessages
			await this.saveClineMessagesAndUpdateHistoryInternal()
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

			// Apply updates to the message
			Object.assign(this.clineMessages[index], updates)

			// Save changes and update history
			await this.saveClineMessagesAndUpdateHistoryInternal()
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

			// Remove the message at the specified index
			this.clineMessages.splice(index, 1)

			// Save changes and update history
			await this.saveClineMessagesAndUpdateHistoryInternal()
		})
	}

	/**
	 * Insert a message at a specific index in the clineMessages array
	 * Used for dynamically reordering messages (e.g., PreToolUse hook messages)
	 *The entire operation (validate, insert, save) is atomic to prevent races (RC-4)
	 */
	async insertClineMessageAt(index: number, message: ClineMessage): Promise<void> {
		return await this.withStateLock(async () => {
			// Validate index (allow inserting at end)
			if (index < 0 || index > this.clineMessages.length) {
				throw new Error(`Invalid index ${index} for message insertion (array length: ${this.clineMessages.length})`)
			}

			// Set conversation history metadata (same as addToClineMessages)
			message.conversationHistoryIndex = this.apiConversationHistory.length - 1
			message.conversationHistoryDeletedRange = this.taskState.conversationHistoryDeletedRange

			// Insert message at the specified position
			this.clineMessages.splice(index, 0, message)

			// Save changes and update history
			await this.saveClineMessagesAndUpdateHistoryInternal()
		})
	}

	/**
	 * Find message index by timestamp
	 * Returns -1 if not found
	 */
	findMessageIndexByTs(ts: number): number {
		return this.clineMessages.findIndex((m) => m.ts === ts)
	}

	/**
	 * Update message by timestamp (convenience method)
	 * Returns true if message was found and updated, false otherwise
	 * The entire operation is atomic to prevent races (RC-4)
	 */
	async updateClineMessageByTs(ts: number, updates: Partial<ClineMessage>): Promise<boolean> {
		return await this.withStateLock(async () => {
			const index = this.findMessageIndexByTs(ts)
			if (index === -1) {
				return false
			}

			// Apply updates to the message
			Object.assign(this.clineMessages[index], updates)

			// Save changes and update history
			await this.saveClineMessagesAndUpdateHistoryInternal()

			return true
		})
	}

	/**
	 * Insert a message before another message (by timestamp)
	 * Used for dynamic message ordering (e.g., PreToolUse before tool approval)
	 * The entire operation is atomic to prevent races (RC-4)
	 */
	async insertMessageBefore(messageToMoveTs: number, targetMessageTs: number): Promise<void> {
		return await this.withStateLock(async () => {
			// Find both messages
			const messageToMoveIndex = this.findMessageIndexByTs(messageToMoveTs)
			const targetMessageIndex = this.findMessageIndexByTs(targetMessageTs)

			// Validate both messages exist
			if (messageToMoveIndex === -1) {
				console.warn(`Message to move with ts ${messageToMoveTs} not found`)
				return
			}
			if (targetMessageIndex === -1) {
				console.warn(`Target message with ts ${targetMessageTs} not found`)
				return
			}

			// Remove the message from its current position
			const [messageToMove] = this.clineMessages.splice(messageToMoveIndex, 1)

			// Recalculate target index (may have shifted if we removed a message before it)
			const newTargetIndex = this.findMessageIndexByTs(targetMessageTs)
			if (newTargetIndex === -1) {
				console.error(`Target message disappeared during move operation`)
				// Re-insert at original position to avoid data loss
				this.clineMessages.splice(messageToMoveIndex, 0, messageToMove)
				return
			}

			// Insert before the target
			this.clineMessages.splice(newTargetIndex, 0, messageToMove)

			// Save changes
			await this.saveClineMessagesAndUpdateHistoryInternal()
		})
	}
}
