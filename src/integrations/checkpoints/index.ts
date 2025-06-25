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
			try {
				const messageTs = await this.callbacks.say("checkpoint_created")
				this.state.checkpointTracker?.commit().then(async (commitHash) => {
					if (messageTs) {
						const targetMessage = this.services.messageStateHandler.getClineMessages().find((m) => m.ts === messageTs)
						if (targetMessage) {
							targetMessage.lastCheckpointHash = commitHash
							await this.services.messageStateHandler.saveClineMessagesAndUpdateHistory()
						}
					}
				})
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
			}
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
					//console.log("Attempt completion checkpoint save with Ts provided", completionMessageTs, commitHash)
					const targetMessage = this.services.messageStateHandler
						.getClineMessages()
						.find((m) => m.ts === completionMessageTs)
					if (targetMessage) {
						targetMessage.lastCheckpointHash = commitHash
						await this.services.messageStateHandler.saveClineMessagesAndUpdateHistory()
					}
				} else {
					// Fallback to findLast if no timestamp provided - update the last completion_result message
					//console.log("No Ts provided on attempt_completion checkpoint save - Using legacy method to find last completion_result message")
					if (lastCompletionResultMessage) {
						lastCompletionResultMessage.lastCheckpointHash = commitHash
						await this.services.messageStateHandler.saveClineMessagesAndUpdateHistory()
					}
				}
			} else {
				console.error("Checkpoint tracker does not exist and could not be initialized for attempt completion")
			}
		}
	}

	/**
	 * Restores a checkpoint by message timestamp
	 * @param messageTs - Timestamp of the message to restore to
	 * @param restoreType - Type of restoration (task, workspace, or both)
	 * @param offset - Optional offset for the message index
	 * @returns checkpointManagerStateUpdate with any state changes that need to be applied
	 */
	// Largely unchanged from original Task class implementation
	async restoreCheckpoint(
		messageTs: number,
		restoreType: ClineCheckpointRestore,
		offset?: number,
	): Promise<CheckpointRestoreStateUpdate> {
		const clineMessages = this.services.messageStateHandler.getClineMessages()
		const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs) - (offset || 0)
		// Find the last message before messageIndex that has a lastCheckpointHash
		const lastHashIndex = findLastIndex(clineMessages.slice(0, messageIndex), (m) => m.lastCheckpointHash !== undefined)
		const message = clineMessages[messageIndex]
		const lastMessageWithHash = clineMessages[lastHashIndex]

		if (!message) {
			console.error("Message not found", clineMessages)
			return {}
		}

		let didWorkspaceRestoreFail = false

		switch (restoreType) {
			case "task":
				break
			case "taskAndWorkspace":
			case "workspace":
				if (!this.config.enableCheckpoints) {
					vscode.window.showErrorMessage("Checkpoints are disabled in settings.")
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
						console.error("Failed to initialize checkpoint tracker:", errorMessage)
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
						vscode.window.showErrorMessage("Failed to restore checkpoint: " + errorMessage)
						didWorkspaceRestoreFail = true
					}
				} else if (offset && lastMessageWithHash.lastCheckpointHash && this.state.checkpointTracker) {
					try {
						await this.state.checkpointTracker.resetHead(lastMessageWithHash.lastCheckpointHash)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						vscode.window.showErrorMessage("Failed to restore offsetcheckpoint: " + errorMessage)
						didWorkspaceRestoreFail = true
					}
				} else if (!offset && lastMessageWithHash.lastCheckpointHash && this.state.checkpointTracker) {
					// Fallback: restore to most recent checkpoint when target message has no checkpoint hash
					console.warn(`Message ${messageTs} has no checkpoint hash, falling back to previous checkpoint`)
					try {
						await this.state.checkpointTracker.resetHead(lastMessageWithHash.lastCheckpointHash)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						vscode.window.showErrorMessage("Failed to restore checkpoint: " + errorMessage)
						didWorkspaceRestoreFail = true
					}
				} else {
					vscode.window.showErrorMessage("Failed to restore checkpoint")
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
	}

	/**
	 * Presents a multi-file diff view between checkpoints
	 * @param messageTs - Timestamp of the message to show diff for
	 * @param seeNewChangesSinceLastTaskCompletion - Whether to show changes since last completion
	 */
	// Largely unchanged from original Task class implementation
	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean) {
		const relinquishButton = () => {
			sendRelinquishControlEvent()
		}
		if (!this.config.enableCheckpoints) {
			vscode.window.showInformationMessage("Checkpoints are disabled in settings. Cannot show diff.")
			relinquishButton()
			return
		}

		console.log("presentMultifileDiff", messageTs)
		const clineMessages = this.services.messageStateHandler.getClineMessages()
		const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs)
		const message = clineMessages[messageIndex]
		if (!message) {
			console.error("Message not found")
			relinquishButton()
			return
		}
		const hash = message.lastCheckpointHash
		if (!hash) {
			console.error("No checkpoint hash found")
			relinquishButton()
			return
		}

		// TODO: handle if this is called from outside original workspace, in which case we need to show user error message we can't show diff outside of workspace?
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
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				this.state.checkpointManagerErrorMessage = errorMessage
				vscode.window.showErrorMessage(errorMessage)
				relinquishButton()
				return
			}
		}

		let changedFiles:
			| {
					relativePath: string
					absolutePath: string
					before: string
					after: string
			  }[]
			| undefined

		try {
			if (seeNewChangesSinceLastTaskCompletion) {
				// Get last task completed
				const lastTaskCompletedMessageCheckpointHash = findLast(
					this.services.messageStateHandler.getClineMessages().slice(0, messageIndex),
					(m) => m.say === "completion_result",
				)?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about
				// if undefined, then we get diff from beginning of git
				// if (!lastTaskCompletedMessage) {
				// 	console.error("No previous task completion message found")
				// 	return
				// }
				// This value *should* always exist
				const firstCheckpointMessageCheckpointHash = this.services.messageStateHandler
					.getClineMessages()
					.find((m) => m.say === "checkpoint_created")?.lastCheckpointHash

				const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash // either use the diff between the first checkpoint and the task completion, or the diff between the latest two task completions

				if (!previousCheckpointHash) {
					vscode.window.showErrorMessage("Unexpected error: No checkpoint hash found")
					relinquishButton()
					return
				}

				// Get changed files between current state and commit
				changedFiles = await this.state.checkpointTracker?.getDiffSet(previousCheckpointHash, hash)
				if (!changedFiles?.length) {
					vscode.window.showInformationMessage("No changes found")
					relinquishButton()
					return
				}
			} else {
				// Get changed files between current state and commit
				changedFiles = await this.state.checkpointTracker?.getDiffSet(hash)
				if (!changedFiles?.length) {
					vscode.window.showInformationMessage("No changes found")
					relinquishButton()
					return
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			vscode.window.showErrorMessage("Failed to retrieve diff set: " + errorMessage)
			relinquishButton()
			return
		}

		// Check if multi-diff editor is enabled in VS Code settings
		// const config = vscode.workspace.getConfiguration()
		// const isMultiDiffEnabled = config.get("multiDiffEditor.experimental.enabled")

		// if (!isMultiDiffEnabled) {
		// 	vscode.window.showErrorMessage(
		// 		"Please enable 'multiDiffEditor.experimental.enabled' in your VS Code settings to use this feature.",
		// 	)
		// 	relinquishButton()
		// 	return
		// }
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
	}

	/**
	 * Checks if the latest task completion has new changes
	 * @returns Promise<boolean> - True if there are new changes since last completion
	 */
	// Largely unchanged from original Task class implementation
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		if (!this.config.enableCheckpoints) {
			return false
		}

		const clineMessages = this.services.messageStateHandler.getClineMessages()
		const messageIndex = findLastIndex(clineMessages, (m) => m.say === "completion_result")
		const message = clineMessages[messageIndex]
		if (!message) {
			console.error("Completion message not found")
			return false
		}
		const hash = message.lastCheckpointHash
		if (!hash) {
			console.error("No checkpoint hash found")
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
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				return false
			}
		}

		// Get last task completed
		const lastTaskCompletedMessage = findLast(
			this.services.messageStateHandler.getClineMessages().slice(0, messageIndex),
			(m) => m.say === "completion_result",
		)

		try {
			// Get last task completed
			const lastTaskCompletedMessageCheckpointHash = lastTaskCompletedMessage?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about
			// if undefined, then we get diff from beginning of git
			// if (!lastTaskCompletedMessage) {
			// 	console.error("No previous task completion message found")
			// 	return
			// }
			// This value *should* always exist
			const firstCheckpointMessageCheckpointHash = this.services.messageStateHandler
				.getClineMessages()
				.find((m) => m.say === "checkpoint_created")?.lastCheckpointHash

			const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash // either use the diff between the first checkpoint and the task completion, or the diff between the latest two task completions

			if (!previousCheckpointHash) {
				return false
			}

			// Get count of changed files between current state and commit
			const changedFilesCount = (await this.state.checkpointTracker?.getDiffCount(previousCheckpointHash, hash)) || 0
			if (changedFilesCount > 0) {
				return true
			}
		} catch (error) {
			console.error("Failed to get diff set:", error)
			return false
		}

		return false
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
