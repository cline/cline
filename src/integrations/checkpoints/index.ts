import * as vscode from "vscode"
import { findLast, findLastIndex } from "@shared/array"
import { ClineCheckpointRestore } from "@shared/WebviewMessage"
import { ClineMessage, ClineApiReqInfo, ClineSay } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { MessageStateHandler } from "../../core/task/message-state"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { sendRelinquishControlEvent } from "@core/controller/ui/subscribeToRelinquishControl"
import { ContextManager } from "@core/context/context-management/ContextManager"
import { getApiMetrics } from "@shared/getApiMetrics"
import { combineApiRequests } from "@shared/combineApiRequests"
import { combineCommandSequences } from "@shared/combineCommandSequences"
import { FileContextTracker } from "@core/context/context-tracking/FileContextTracker"

// Type definitions for better code organization
type SayFunction = (
	type: ClineSay,
	text?: string,
	images?: string[],
	files?: string[],
	partial?: boolean,
) => Promise<number | undefined>
type UpdateTaskHistoryFunction = (historyItem: HistoryItem) => Promise<HistoryItem[]>

interface CheckpointManagerTask {
	readonly taskId: string
}
interface CheckpointManagerConfig {
	readonly enableCheckpoints: boolean
}
interface CheckpointManagerServices {
	readonly fileContextTracker: FileContextTracker
	readonly diffViewProvider: DiffViewProvider
	readonly messageStateHandler: MessageStateHandler
	readonly context: vscode.ExtensionContext
}
interface CheckpointManagerCallbacks {
	readonly updateTaskHistory: UpdateTaskHistoryFunction
	readonly cancelTask: () => Promise<void>
	readonly say: SayFunction
}
interface CheckpointManagerInternalState {
	conversationHistoryDeletedRange?: [number, number]
	checkpointTracker?: CheckpointTracker
	checkpointManagerErrorMessage?: string
	checkpointTrackerInitPromise?: Promise<CheckpointTracker | undefined>
}

interface CheckpointRestoreStateUpdate {
	conversationHistoryDeletedRange?: [number, number]
	checkpointManagerErrorMessage?: string
}

/**
 * TaskCheckpointManager
 *
 * A dedicated service for managing all checkpoint-related operations within a task.
 * Provides a clean separation of concerns from the main Task class while maintaining
 * full access to necessary dependencies and state.
 *
 * Public API:
 * - saveCheckpoint: Creates a new checkpoint of the current workspace state
 * - restoreCheckpoint: Restores the task to a previous checkpoint
 * - presentMultifileDiff: Displays a multi-file diff view between checkpoints
 * - doesLatestTaskCompletionHaveNewChanges: Checks if the latest task completion has new changes, used by the "See New Changes" button
 *
 * This class is designed as the main interface between the task and the checkpoint system. It is responsible for:
 * - Task-specific checkpoint operations (save/restore/diff)
 * - State management and coordination with other Task components
 * - Interaction with message state, file context tracking etc.
 * - User interaction (error messages, notifications)
 *
 * For checkpoint operations, the CheckpointTracker class is used to interact with the underlying git logic.
 */
export class TaskCheckpointManager {
	private readonly task: CheckpointManagerTask
	private readonly config: CheckpointManagerConfig
	private readonly services: CheckpointManagerServices
	private readonly callbacks: CheckpointManagerCallbacks

	private state: CheckpointManagerInternalState

	constructor(
		task: CheckpointManagerTask,
		config: CheckpointManagerConfig,
		services: CheckpointManagerServices,
		callbacks: CheckpointManagerCallbacks,
		initialState: CheckpointManagerInternalState,
	) {
		this.task = Object.freeze(task)
		this.config = config
		this.services = services
		this.callbacks = Object.freeze(callbacks)
		this.state = { ...initialState }
	}

	// ============================================================================
	// Public API - Core checkpoints operations
	// ============================================================================

	/**
	 * Creates a checkpoint of the current workspace state
	 * @param isAttemptCompletionMessage - Whether this checkpoint is for an attempt completion message
	 * @param completionMessageTs - Optional timestamp of the completion message to update with checkpoint hash
	 */
	async saveCheckpoint(isAttemptCompletionMessage: boolean = false, completionMessageTs?: number): Promise<void> {
		try {
			// If checkpoints are disabled, return early
			if (!this.config.enableCheckpoints) {
				return
			}

			// Set isCheckpointCheckedOut to false for all prior checkpoint_created messages
			const clineMessages = this.services.messageStateHandler.getClineMessages()
			clineMessages.forEach((message) => {
				if (message.say === "checkpoint_created") {
					message.isCheckpointCheckedOut = false
				}
			})

			// Prevent repetitive checkpointTracker initialization errors on non-attempt completion messages
			if (!this.state.checkpointTracker && !isAttemptCompletionMessage && !this.state.checkpointManagerErrorMessage) {
				await this.checkpointTrackerCheckAndInit()
			}
			// attempt completion messages give it one last chance
			else if (!this.state.checkpointTracker && isAttemptCompletionMessage) {
				await this.checkpointTrackerCheckAndInit()
			}

			// Critical failure to initialize checkpoint tracker, return early
			if (!this.state.checkpointTracker) {
				console.error(
					`[TaskCheckpointManager] Failed to save checkpoint for task ${this.task.taskId}: Checkpoint tracker not available`,
				)
				return
			}

			// Non attempt-completion messages call for a checkpoint_created message to be added
			if (!isAttemptCompletionMessage) {
				// Ensure we aren't creating back-to-back checkpoint_created messages
				const lastMessage = clineMessages.at(-1)
				if (lastMessage?.say === "checkpoint_created") {
					return
				}

				// Create a new checkpoint_created message and asynchronously add the commitHash to the say message
				const messageTs = await this.callbacks.say("checkpoint_created")
				this.state.checkpointTracker
					?.commit()
					.then(async (commitHash) => {
						if (messageTs) {
							const targetMessage = this.services.messageStateHandler
								.getClineMessages()
								.find((m) => m.ts === messageTs)
							if (targetMessage) {
								targetMessage.lastCheckpointHash = commitHash
								await this.services.messageStateHandler.saveClineMessagesAndUpdateHistory()
							}
						}
					})
					.catch((error) => {
						console.error(
							`[TaskCheckpointManager] Failed to create checkpoint commit for task ${this.task.taskId}:`,
							error,
						)
					})
			} else {
				// attempt_completion messages are special
				// First check last 3 messages to see if we already have a recent completion checkpoint
				// If we do, skip creating a duplicate checkpoint
				const lastFiveclineMessages = this.services.messageStateHandler.getClineMessages().slice(-3)
				const lastCompletionResultMessage = findLast(lastFiveclineMessages, (m) => m.say === "completion_result")
				if (lastCompletionResultMessage?.lastCheckpointHash) {
					console.log("Completion checkpoint already exists, skipping duplicate checkpoint creation")
					return
				}

				// For attempt_completion, commit then update the completion_result message with the checkpoint hash
				if (this.state.checkpointTracker) {
					const commitHash = await this.state.checkpointTracker.commit()

					// If a completionMessageTs is provided, update that specific message with the checkpoint hash
					if (completionMessageTs) {
						const targetMessage = this.services.messageStateHandler
							.getClineMessages()
							.find((m) => m.ts === completionMessageTs)
						if (targetMessage) {
							targetMessage.lastCheckpointHash = commitHash
							await this.services.messageStateHandler.saveClineMessagesAndUpdateHistory()
						}
					} else {
						// Fallback to findLast if no timestamp provided - update the last completion_result message
						if (lastCompletionResultMessage) {
							lastCompletionResultMessage.lastCheckpointHash = commitHash
							await this.services.messageStateHandler.saveClineMessagesAndUpdateHistory()
						}
					}
				} else {
					console.error(
						`[TaskCheckpointManager] Checkpoint tracker does not exist and could not be initialized for attempt completion for task ${this.task.taskId}`,
					)
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error(`[TaskCheckpointManager] Failed to save checkpoint for task ${this.task.taskId}:`, errorMessage)
		}
	}

	/**
	 * Restores a checkpoint by message timestamp
	 * @param messageTs - Timestamp of the message to restore to
	 * @param restoreType - Type of restoration (task, workspace, or both)
	 * @param offset - Optional offset for the message index
	 * @returns checkpointManagerStateUpdate with any state changes that need to be applied
	 */
	async restoreCheckpoint(
		messageTs: number,
		restoreType: ClineCheckpointRestore,
		offset?: number,
	): Promise<CheckpointRestoreStateUpdate> {
		try {
			const clineMessages = this.services.messageStateHandler.getClineMessages()
			const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs) - (offset || 0)
			// Find the last message before messageIndex that has a lastCheckpointHash
			const lastHashIndex = findLastIndex(clineMessages.slice(0, messageIndex), (m) => m.lastCheckpointHash !== undefined)
			const message = clineMessages[messageIndex]
			const lastMessageWithHash = clineMessages[lastHashIndex]

			if (!message) {
				console.error(`[TaskCheckpointManager] Message not found for timestamp ${messageTs} in task ${this.task.taskId}`)
				return {}
			}

			let didWorkspaceRestoreFail = false

			switch (restoreType) {
				case "task":
					break
				case "taskAndWorkspace":
				case "workspace":
					if (!this.config.enableCheckpoints) {
						const errorMessage = "Checkpoints are disabled in settings."
						console.error(`[TaskCheckpointManager] ${errorMessage} for task ${this.task.taskId}`)
						vscode.window.showErrorMessage(errorMessage)
						didWorkspaceRestoreFail = true
						break
					}

					if (!this.state.checkpointTracker && !this.state.checkpointManagerErrorMessage) {
						try {
							this.state.checkpointTracker = await CheckpointTracker.create(
								this.task.taskId,
								this.services.context.globalStorageUri.fsPath,
								this.config.enableCheckpoints,
							)
							this.services.messageStateHandler.setCheckpointTracker(this.state.checkpointTracker)
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : "Unknown error"
							console.error(
								`[TaskCheckpointManager] Failed to initialize checkpoint tracker for task ${this.task.taskId}:`,
								errorMessage,
							)
							this.state.checkpointManagerErrorMessage = errorMessage
							vscode.window.showErrorMessage(errorMessage)
							didWorkspaceRestoreFail = true
						}
					}
					if (message.lastCheckpointHash && this.state.checkpointTracker) {
						try {
							await this.state.checkpointTracker.resetHead(message.lastCheckpointHash)
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : "Unknown error"
							console.error(
								`[TaskCheckpointManager] Failed to restore checkpoint for task ${this.task.taskId}:`,
								errorMessage,
							)
							vscode.window.showErrorMessage("Failed to restore checkpoint: " + errorMessage)
							didWorkspaceRestoreFail = true
						}
					} else if (offset && lastMessageWithHash.lastCheckpointHash && this.state.checkpointTracker) {
						try {
							await this.state.checkpointTracker.resetHead(lastMessageWithHash.lastCheckpointHash)
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : "Unknown error"
							console.error(
								`[TaskCheckpointManager] Failed to restore offset checkpoint for task ${this.task.taskId}:`,
								errorMessage,
							)
							vscode.window.showErrorMessage("Failed to restore offsetcheckpoint: " + errorMessage)
							didWorkspaceRestoreFail = true
						}
					} else if (!offset && lastMessageWithHash.lastCheckpointHash && this.state.checkpointTracker) {
						// Fallback: restore to most recent checkpoint when target message has no checkpoint hash
						console.warn(
							`[TaskCheckpointManager] Message ${messageTs} has no checkpoint hash, falling back to previous checkpoint for task ${this.task.taskId}`,
						)
						try {
							await this.state.checkpointTracker.resetHead(lastMessageWithHash.lastCheckpointHash)
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : "Unknown error"
							console.error(
								`[TaskCheckpointManager] Failed to restore fallback checkpoint for task ${this.task.taskId}:`,
								errorMessage,
							)
							vscode.window.showErrorMessage("Failed to restore checkpoint: " + errorMessage)
							didWorkspaceRestoreFail = true
						}
					} else {
						const errorMessage = "Failed to restore checkpoint: No valid checkpoint hash found"
						console.error(`[TaskCheckpointManager] ${errorMessage} for task ${this.task.taskId}`)
						vscode.window.showErrorMessage(errorMessage)
						didWorkspaceRestoreFail = true
					}
					break
			}

			const checkpointManagerStateUpdate: CheckpointRestoreStateUpdate = {}

			if (!didWorkspaceRestoreFail) {
				await this.handleSuccessfulRestore(restoreType, message, messageIndex, messageTs)

				// Collect state updates
				if (this.state.conversationHistoryDeletedRange !== undefined) {
					checkpointManagerStateUpdate.conversationHistoryDeletedRange = this.state.conversationHistoryDeletedRange
				}
			} else {
				sendRelinquishControlEvent()

				if (this.state.checkpointManagerErrorMessage !== undefined) {
					checkpointManagerStateUpdate.checkpointManagerErrorMessage = this.state.checkpointManagerErrorMessage
				}
			}

			return checkpointManagerStateUpdate
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error(`[TaskCheckpointManager] Failed to restore checkpoint for task ${this.task.taskId}:`, errorMessage)
			sendRelinquishControlEvent()
			return {
				checkpointManagerErrorMessage: errorMessage,
			}
		}
	}

	/**
	 * Presents a multi-file diff view between checkpoints
	 * @param messageTs - Timestamp of the message to show diff for
	 * @param seeNewChangesSinceLastTaskCompletion - Whether to show changes since last completion
	 */
	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void> {
		const relinquishButton = () => {
			sendRelinquishControlEvent()
		}

		try {
			if (!this.config.enableCheckpoints) {
				const errorMessage = "Checkpoints are disabled in settings. Cannot show diff."
				console.error(`[TaskCheckpointManager] ${errorMessage} for task ${this.task.taskId}`)
				vscode.window.showInformationMessage(errorMessage)
				relinquishButton()
				return
			}

			console.log(`[TaskCheckpointManager] presentMultifileDiff for task ${this.task.taskId}, messageTs: ${messageTs}`)
			const clineMessages = this.services.messageStateHandler.getClineMessages()
			const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs)
			const message = clineMessages[messageIndex]
			if (!message) {
				console.error(`[TaskCheckpointManager] Message not found for timestamp ${messageTs} in task ${this.task.taskId}`)
				relinquishButton()
				return
			}
			const hash = message.lastCheckpointHash
			if (!hash) {
				console.error(
					`[TaskCheckpointManager] No checkpoint hash found for message ${messageTs} in task ${this.task.taskId}`,
				)
				relinquishButton()
				return
			}

			// Initialize checkpoint tracker if needed
			if (!this.state.checkpointTracker && this.config.enableCheckpoints && !this.state.checkpointManagerErrorMessage) {
				try {
					this.state.checkpointTracker = await CheckpointTracker.create(
						this.task.taskId,
						this.services.context.globalStorageUri.fsPath,
						this.config.enableCheckpoints,
					)
					this.services.messageStateHandler.setCheckpointTracker(this.state.checkpointTracker)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					console.error(
						`[TaskCheckpointManager] Failed to initialize checkpoint tracker for task ${this.task.taskId}:`,
						errorMessage,
					)
					this.state.checkpointManagerErrorMessage = errorMessage
					vscode.window.showErrorMessage(errorMessage)
					relinquishButton()
					return
				}
			}

			if (!this.state.checkpointTracker) {
				console.error(`[TaskCheckpointManager] Checkpoint tracker not available for task ${this.task.taskId}`)
				vscode.window.showErrorMessage("Checkpoint tracker not available")
				relinquishButton()
				return
			}

			let changedFiles:
				| {
						relativePath: string
						absolutePath: string
						before: string
						after: string
				  }[]
				| undefined

			if (seeNewChangesSinceLastTaskCompletion) {
				// Get last task completed
				const lastTaskCompletedMessageCheckpointHash = findLast(
					this.services.messageStateHandler.getClineMessages().slice(0, messageIndex),
					(m) => m.say === "completion_result",
				)?.lastCheckpointHash

				// This value *should* always exist
				const firstCheckpointMessageCheckpointHash = this.services.messageStateHandler
					.getClineMessages()
					.find((m) => m.say === "checkpoint_created")?.lastCheckpointHash

				const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash

				if (!previousCheckpointHash) {
					const errorMessage = "Unexpected error: No checkpoint hash found"
					console.error(`[TaskCheckpointManager] ${errorMessage} for task ${this.task.taskId}`)
					vscode.window.showErrorMessage(errorMessage)
					relinquishButton()
					return
				}

				// Get changed files between current state and commit
				changedFiles = await this.state.checkpointTracker.getDiffSet(previousCheckpointHash, hash)
				if (!changedFiles?.length) {
					vscode.window.showInformationMessage("No changes found")
					relinquishButton()
					return
				}
			} else {
				// Get changed files between current state and commit
				changedFiles = await this.state.checkpointTracker.getDiffSet(hash)
				if (!changedFiles?.length) {
					vscode.window.showInformationMessage("No changes found")
					relinquishButton()
					return
				}
			}

			// Open multi-diff editor
			await vscode.commands.executeCommand(
				"vscode.changes",
				seeNewChangesSinceLastTaskCompletion ? "New changes" : "Changes since snapshot",
				changedFiles.map((file) => [
					vscode.Uri.file(file.absolutePath),
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${file.relativePath}`).with({
						query: Buffer.from(file.before ?? "").toString("base64"),
					}),
					vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${file.relativePath}`).with({
						query: Buffer.from(file.after ?? "").toString("base64"),
					}),
				]),
			)
			relinquishButton()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error(`[TaskCheckpointManager] Failed to present multifile diff for task ${this.task.taskId}:`, errorMessage)
			vscode.window.showErrorMessage("Failed to retrieve diff set: " + errorMessage)
			relinquishButton()
		}
	}

	/**
	 * Creates a checkpoint commit in the underlying tracker
	 * @returns Promise<string | undefined> The created commit hash, or undefined if failed
	 */
	async commit(): Promise<string | undefined> {
		try {
			if (!this.config.enableCheckpoints) {
				return undefined
			}

			if (!this.state.checkpointTracker) {
				await this.checkpointTrackerCheckAndInit()
			}

			if (!this.state.checkpointTracker) {
				console.error(`[TaskCheckpointManager] Checkpoint tracker not available for commit in task ${this.task.taskId}`)
				return undefined
			}

			return await this.state.checkpointTracker.commit()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error(
				`[TaskCheckpointManager] Failed to create checkpoint commit for task ${this.task.taskId}:`,
				errorMessage,
			)
			return undefined
		}
	}

	/**
	 * Checks if the latest task completion has new changes
	 * @returns Promise<boolean> - True if there are new changes since last completion
	 */
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		try {
			if (!this.config.enableCheckpoints) {
				return false
			}

			const clineMessages = this.services.messageStateHandler.getClineMessages()
			const messageIndex = findLastIndex(clineMessages, (m) => m.say === "completion_result")
			const message = clineMessages[messageIndex]
			if (!message) {
				console.error(`[TaskCheckpointManager] Completion message not found for task ${this.task.taskId}`)
				return false
			}
			const hash = message.lastCheckpointHash
			if (!hash) {
				console.error(
					`[TaskCheckpointManager] No checkpoint hash found for completion message in task ${this.task.taskId}`,
				)
				return false
			}

			if (this.config.enableCheckpoints && !this.state.checkpointTracker && !this.state.checkpointManagerErrorMessage) {
				try {
					this.state.checkpointTracker = await CheckpointTracker.create(
						this.task.taskId,
						this.services.context.globalStorageUri.fsPath,
						this.config.enableCheckpoints,
					)
					this.services.messageStateHandler.setCheckpointTracker(this.state.checkpointTracker)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					console.error(
						`[TaskCheckpointManager] Failed to initialize checkpoint tracker for task ${this.task.taskId}:`,
						errorMessage,
					)
					return false
				}
			}

			if (!this.state.checkpointTracker) {
				console.error(`[TaskCheckpointManager] Checkpoint tracker not available for task ${this.task.taskId}`)
				return false
			}

			// Get last task completed
			const lastTaskCompletedMessage = findLast(
				this.services.messageStateHandler.getClineMessages().slice(0, messageIndex),
				(m) => m.say === "completion_result",
			)

			// Get last task completed
			const lastTaskCompletedMessageCheckpointHash = lastTaskCompletedMessage?.lastCheckpointHash

			// This value *should* always exist
			const firstCheckpointMessageCheckpointHash = this.services.messageStateHandler
				.getClineMessages()
				.find((m) => m.say === "checkpoint_created")?.lastCheckpointHash

			const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash

			if (!previousCheckpointHash) {
				console.error(`[TaskCheckpointManager] No previous checkpoint hash found for task ${this.task.taskId}`)
				return false
			}

			// Get count of changed files between current state and commit
			const changedFilesCount = (await this.state.checkpointTracker.getDiffCount(previousCheckpointHash, hash)) || 0
			return changedFilesCount > 0
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error(`[TaskCheckpointManager] Failed to check for new changes in task ${this.task.taskId}:`, errorMessage)
			return false
		}
	}

	/**
	 * Handles the successful restoration logic for different restore types
	 */
	// Largely unchanged from original Task class implementation
	private async handleSuccessfulRestore(
		restoreType: ClineCheckpointRestore,
		message: ClineMessage,
		messageIndex: number,
		messageTs: number,
	): Promise<void> {
		switch (restoreType) {
			case "task":
			case "taskAndWorkspace":
				// Update conversation history deleted range in our state
				this.state.conversationHistoryDeletedRange = message.conversationHistoryDeletedRange

				const apiConversationHistory = this.services.messageStateHandler.getApiConversationHistory()
				const newConversationHistory = apiConversationHistory.slice(0, (message.conversationHistoryIndex || 0) + 2) // +1 since this index corresponds to the last user message, and another +1 since slice end index is exclusive
				await this.services.messageStateHandler.overwriteApiConversationHistory(newConversationHistory)

				// update the context history state
				const contextManager = new ContextManager()
				await contextManager.truncateContextHistory(
					message.ts,
					await ensureTaskDirectoryExists(this.getContext(), this.task.taskId),
				)

				// aggregate deleted api reqs info so we don't lose costs/tokens
				const clineMessages = this.services.messageStateHandler.getClineMessages()
				const deletedMessages = clineMessages.slice(messageIndex + 1)
				const deletedApiReqsMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(deletedMessages)))

				// Detect files edited after this message timestamp for file context warning
				// Only needed for task-only restores when a user edits a message or restores the task context, but not the files.
				if (restoreType === "task") {
					const filesEditedAfterMessage = await this.services.fileContextTracker.detectFilesEditedAfterMessage(
						messageTs,
						deletedMessages,
					)
					if (filesEditedAfterMessage.length > 0) {
						await this.services.fileContextTracker.storePendingFileContextWarning(filesEditedAfterMessage)
					}
				}

				const newClineMessages = clineMessages.slice(0, messageIndex + 1)
				await this.services.messageStateHandler.overwriteClineMessages(newClineMessages) // calls saveClineMessages which saves historyItem

				await this.callbacks.say(
					"deleted_api_reqs",
					JSON.stringify({
						tokensIn: deletedApiReqsMetrics.totalTokensIn,
						tokensOut: deletedApiReqsMetrics.totalTokensOut,
						cacheWrites: deletedApiReqsMetrics.totalCacheWrites,
						cacheReads: deletedApiReqsMetrics.totalCacheReads,
						cost: deletedApiReqsMetrics.totalCost,
					} satisfies ClineApiReqInfo),
				)
				break
			case "workspace":
				break
		}

		switch (restoreType) {
			case "task":
				vscode.window.showInformationMessage("Task messages have been restored to the checkpoint")
				break
			case "workspace":
				vscode.window.showInformationMessage("Workspace files have been restored to the checkpoint")
				break
			case "taskAndWorkspace":
				vscode.window.showInformationMessage("Task and workspace have been restored to the checkpoint")
				break
		}

		if (restoreType !== "task") {
			// Set isCheckpointCheckedOut flag on the message
			// Find all checkpoint messages before this one
			const checkpointMessages = this.services.messageStateHandler
				.getClineMessages()
				.filter((m) => m.say === "checkpoint_created")
			const currentMessageIndex = checkpointMessages.findIndex((m) => m.ts === messageTs)

			// Set isCheckpointCheckedOut to false for all checkpoint messages
			checkpointMessages.forEach((m, i) => {
				m.isCheckpointCheckedOut = i === currentMessageIndex
			})
		}

		await this.services.messageStateHandler.saveClineMessagesAndUpdateHistory()

		// Cancel and reinitialize the task to get updated messages
		await this.callbacks.cancelTask()
	}

	// ============================================================================
	// State management - interfaces for updating internal state
	// ============================================================================

	/**
	 * Checks for an active checkpoint tracker instance, creates if needed
	 * Uses promise-based synchronization to prevent race conditions when called concurrently
	 */
	async checkpointTrackerCheckAndInit(): Promise<CheckpointTracker | undefined> {
		// If tracker already exists or there was an error, return immediately
		if (this.state.checkpointTracker) {
			return this.state.checkpointTracker
		}

		// If initialization is already in progress, wait for it to complete
		if (this.state.checkpointTrackerInitPromise) {
			return await this.state.checkpointTrackerInitPromise
		}

		// Start initialization and store the promise to prevent concurrent attempts
		this.state.checkpointTrackerInitPromise = this.initializeCheckpointTracker()

		try {
			const tracker = await this.state.checkpointTrackerInitPromise
			return tracker
		} finally {
			// Clear the promise once initialization is complete (success or failure)
			this.state.checkpointTrackerInitPromise = undefined
		}
	}

	/**
	 * Internal method to actually create the checkpoint tracker
	 */
	private async initializeCheckpointTracker(): Promise<CheckpointTracker | undefined> {
		try {
			const tracker = await CheckpointTracker.create(
				this.task.taskId,
				this.services.context.globalStorageUri.fsPath,
				this.config.enableCheckpoints,
			)

			// Update the state with the created tracker
			this.state.checkpointTracker = tracker
			return tracker
		} catch (error) {
			// Store error message to prevent future repetative initialization attempts
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			this.setcheckpointManagerErrorMessage(errorMessage)
			console.error("Failed to initialize checkpoint tracker:", errorMessage)
			// TODO - Do we need to post state to webview here? TBD
			return undefined
		}
	}

	/**
	 * Updates the checkpoint tracker instance
	 */
	setCheckpointTracker(checkpointTracker: CheckpointTracker | undefined): void {
		this.state.checkpointTracker = checkpointTracker
	}

	/**
	 * Updates the checkpoint tracker error message
	 */
	setcheckpointManagerErrorMessage(errorMessage: string | undefined): void {
		this.state.checkpointManagerErrorMessage = errorMessage
		// TODO - Future telemetry event capture here
	}

	/**
	 * Updates the conversation history deleted range
	 */
	updateConversationHistoryDeletedRange(range: [number, number] | undefined): void {
		this.state.conversationHistoryDeletedRange = range
		// TODO - Future telemetry event capture here
	}

	// ============================================================================
	// Internal utilities - Private helpers for checkpoint operations
	// ============================================================================

	/**
	 * Gets the extension context with proper error handling
	 */
	private getContext(): vscode.ExtensionContext {
		if (!this.services.context) {
			throw new Error("Unable to access extension context")
		}
		return this.services.context
	}

	/**
	 * Provides read-only access to current state for internal operations
	 */
	//private get currentState(): Readonly<CheckpointManagerInternalState> {
	//	return Object.freeze({ ...this.state })
	//}

	/**
	 * Provides public read-only access to current state
	 */
	public getCurrentState(): Readonly<CheckpointManagerInternalState> {
		return Object.freeze({ ...this.state })
	}

	/**
	 * Provides read-only access to dependencies for internal operations
	 */
	//private get deps(): Readonly<CheckpointManagerDependencies> {
	//	return this.dependencies
	//}
}

// ============================================================================
// Factory function for clean instantiation
// ============================================================================

/**
 * Creates a new TaskCheckpointManager instance
 */
export function createTaskCheckpointManager(
	task: CheckpointManagerTask,
	config: CheckpointManagerConfig,
	services: CheckpointManagerServices,
	callbacks: CheckpointManagerCallbacks,
	initialState: CheckpointManagerInternalState,
): TaskCheckpointManager {
	return new TaskCheckpointManager(task, config, services, callbacks, initialState)
}
