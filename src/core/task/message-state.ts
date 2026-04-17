import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { EventEmitter } from "events"
import getFolderSize from "get-folder-size"
import Mutex from "p-mutex"
import { findLastIndex } from "@/shared/array"
import { combineApiRequests } from "@/shared/combineApiRequests"
import { combineCommandSequences } from "@/shared/combineCommandSequences"
import { ClineMessage } from "@/shared/ExtensionMessage"
import { getApiMetrics } from "@/shared/getApiMetrics"
import { HistoryItem } from "@/shared/HistoryItem"
import { ClineStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { getCwd, getDesktopDir } from "@/utils/path"
import { ensureTaskDirectoryExists, saveApiConversationHistory, saveClineMessages } from "../storage/disk"
import { TaskState } from "./TaskState"

const TASK_DIRECTORY_SIZE_CACHE_TTL_MS = 5_000

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
	now?: () => number
	getTaskDirectorySize?: (taskDir: string) => Promise<number>
	getCurrentWorkingDirectory?: () => Promise<string>
	ensureTaskDirectoryExists?: (taskId: string) => Promise<string>
	saveClineMessages?: (taskId: string, messages: ClineMessage[]) => Promise<void>
	saveApiConversationHistory?: (taskId: string, messages: ClineStorageMessage[]) => Promise<void>
}

export class MessageStateHandler extends EventEmitter<MessageStateHandlerEvents> {
	private apiConversationHistory: ClineStorageMessage[] = []
	private clineMessages: ClineMessage[] = []
	private taskIsFavorited: boolean
	private checkpointTracker: CheckpointTracker | undefined
	private updateTaskHistory: (historyItem: HistoryItem) => Promise<HistoryItem[]>
	private taskId: string
	private ulid: string
	private taskState: TaskState
	private readonly now: () => number
	private readonly getTaskDirectorySize: (taskDir: string) => Promise<number>
	private readonly getCurrentWorkingDirectory: () => Promise<string>
	private readonly ensureTaskDirectoryExistsFn: (taskId: string) => Promise<string>
	private readonly saveClineMessagesFn: (taskId: string, messages: ClineMessage[]) => Promise<void>
	private readonly saveApiConversationHistoryFn: (taskId: string, messages: ClineStorageMessage[]) => Promise<void>
	private hasCachedTaskDirSize = false
	private cachedTaskDirSize = 0
	private lastTaskDirSizeComputedAt = 0
	private pendingTaskDirSizePromise?: Promise<number>

	// Mutex to prevent concurrent state modifications (RC-4)
	// Protects against data loss from race conditions when multiple
	// operations try to modify message state simultaneously
	// This follows the same pattern as Task.stateMutex for consistency
	private stateMutex = new Mutex()

	constructor(params: MessageStateHandlerParams) {
		super()
		this.taskId = params.taskId
		this.ulid = params.ulid
		this.taskState = params.taskState
		this.taskIsFavorited = params.taskIsFavorited ?? false
		this.updateTaskHistory = params.updateTaskHistory
		this.now = params.now ?? (() => Date.now())
		this.getTaskDirectorySize =
			params.getTaskDirectorySize ??
			(async (taskDir: string) => {
				return await getFolderSize.loose(taskDir)
			})
		this.getCurrentWorkingDirectory = params.getCurrentWorkingDirectory ?? (() => getCwd(getDesktopDir()))
		this.ensureTaskDirectoryExistsFn = params.ensureTaskDirectoryExists ?? ensureTaskDirectoryExists
		this.saveClineMessagesFn = params.saveClineMessages ?? saveClineMessages
		this.saveApiConversationHistoryFn = params.saveApiConversationHistory ?? saveApiConversationHistory
	}

	private async getCachedTaskDirectorySize(taskDir: string): Promise<number> {
		const currentTime = this.now()
		if (this.pendingTaskDirSizePromise) {
			return await this.pendingTaskDirSizePromise
		}
		if (this.hasCachedTaskDirSize && currentTime - this.lastTaskDirSizeComputedAt < TASK_DIRECTORY_SIZE_CACHE_TTL_MS) {
			return this.cachedTaskDirSize
		}

		this.pendingTaskDirSizePromise = (async () => {
			try {
				const size = await this.getTaskDirectorySize(taskDir)
				this.hasCachedTaskDirSize = true
				this.cachedTaskDirSize = size
				this.lastTaskDirSizeComputedAt = this.now()
				return size
			} finally {
				this.pendingTaskDirSizePromise = undefined
			}
		})()

		return await this.pendingTaskDirSizePromise
	}

	/**
	 * Emit a clineMessagesChanged event with the change details
	 */
	private emitClineMessagesChanged(change: ClineMessageChange): void {
		this.emit("clineMessagesChanged", change)
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
		const previousMessages = this.clineMessages
		this.clineMessages = newMessages
		this.emitClineMessagesChanged({
			type: "set",
			messages: this.clineMessages,
			previousMessages,
		})
	}

	/**
	 * Internal method to save messages and update history (without mutex protection)
	 * This is used by methods that already hold the stateMutex lock
	 * Should NOT be called directly - use saveClineMessagesAndUpdateHistory() instead
	 */
	private async saveClineMessagesAndUpdateHistoryInternal(): Promise<void> {
		try {
			await this.saveClineMessagesFn(this.taskId, this.clineMessages)

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
			const taskDir = await this.ensureTaskDirectoryExistsFn(this.taskId)
			let taskDirSize = 0
			try {
				// getFolderSize.loose silently ignores errors
				// returns # of bytes, size/1000/1000 = MB
				taskDirSize = await this.getCachedTaskDirectorySize(taskDir)
			} catch (error) {
				Logger.error("Failed to get task directory size:", taskDir, error)
			}
			const cwd = await this.getCurrentWorkingDirectory()
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
			Logger.error("Failed to save cline messages:", error)
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
			await this.saveApiConversationHistoryFn(this.taskId, this.apiConversationHistory)
		})
	}

	async saveApiConversationHistory(): Promise<void> {
		return await this.withStateLock(async () => {
			await this.saveApiConversationHistoryFn(this.taskId, this.apiConversationHistory)
		})
	}

	async overwriteApiConversationHistory(newHistory: ClineStorageMessage[]): Promise<void> {
		// Protect with mutex to prevent concurrent modifications from corrupting data (RC-4)
		return await this.withStateLock(async () => {
			if (Object.is(this.apiConversationHistory, newHistory)) {
				return
			}
			this.apiConversationHistory = newHistory
			await this.saveApiConversationHistoryFn(this.taskId, this.apiConversationHistory)
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
			await this.saveClineMessagesAndUpdateHistoryInternal()
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

			const currentMessage = this.clineMessages[index]
			const updateEntries = Object.entries(updates) as Array<[keyof ClineMessage, ClineMessage[keyof ClineMessage]]>
			if (updateEntries.length === 0) {
				return
			}
			const hasActualChange = updateEntries.some(([key, value]) => !Object.is(currentMessage[key], value))
			if (!hasActualChange) {
				return
			}

			// Capture previous state before mutation
			const previousMessage = { ...currentMessage }

			// Apply updates to the message
			Object.assign(currentMessage, updates)

			this.emitClineMessagesChanged({
				type: "update",
				messages: this.clineMessages,
				index,
				previousMessage,
				message: currentMessage,
			})

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
			await this.saveClineMessagesAndUpdateHistoryInternal()
		})
	}
}
