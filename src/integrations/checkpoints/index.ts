import * as vscode from "vscode"
import { findLast, findLastIndex } from "@shared/array"
import { ClineCheckpointRestore } from "@shared/WebviewMessage"
import { ClineMessage, ClineApiReqInfo, COMPLETION_RESULT_CHANGES_FLAG, ClineSay } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { DIFF_VIEW_URI_SCHEME, DiffViewProvider } from "@integrations/editor/DiffViewProvider"
import { MessageStateHandler } from "../../core/task/message-state"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { sendRelinquishControlEvent } from "@core/controller/ui/subscribeToRelinquishControl"

// Type definitions for better code organization
type SayFunction = (type: ClineSay, text?: string, images?: string[], files?: string[], partial?: boolean) => Promise<undefined>
type UpdateTaskHistoryFunction = (historyItem: HistoryItem) => Promise<HistoryItem[]>

interface CheckpointManagerDependencies {
	readonly taskId: string
	readonly context: vscode.ExtensionContext
	readonly enableCheckpoints: boolean
	readonly diffViewProvider: DiffViewProvider
	readonly updateTaskHistory: UpdateTaskHistoryFunction
	readonly say: SayFunction
	readonly messageStateHandler: MessageStateHandler
	readonly cancelTask: () => Promise<void>
}

interface CheckpointManagerState {
	conversationHistoryDeletedRange?: [number, number]
	checkpointTracker?: CheckpointTracker
	checkpointTrackerErrorMessage?: string
	checkpointTrackerInitPromise?: Promise<CheckpointTracker | undefined>
}

/**
 * TaskCheckpointManager
 *
 * A dedicated service for managing all checkpoint-related operations within a task.
 * Provides a clean separation of concerns from the main Task class while maintaining
 * full access to necessary dependencies and state.
 *
 * Key Responsibilities:
 * - Creating and saving checkpoints at strategic points
 * - Restoring from checkpoints (task state and/or workspace files)
 * - Presenting multi-file diffs between checkpoint states
 * - Tracking changes since task completion for user feedback
 *
 * Architecture Benefits:
 * - Encapsulates complex checkpoint logic away from Task class
 * - Provides type-safe interfaces for all dependencies
 * - Maintains immutable dependencies while allowing state updates
 * - Enables easier testing and maintenance of checkpoint features
 */
export class TaskCheckpointManager {
	// Immutable dependencies - set once during construction
	// These never change after the manager is created
	private readonly dependencies: CheckpointManagerDependencies

	// Mutable state - updated as task progresses
	// This gets updated as the user works and checkpoints are created
	private state: CheckpointManagerState

	constructor(dependencies: CheckpointManagerDependencies, initialState: CheckpointManagerState) {
		this.dependencies = Object.freeze(dependencies)
		this.state = { ...initialState }
	}

	// ============================================================================
	// Public API - Core checkpoint operations
	// ============================================================================

	/**
	 * Creates a checkpoint of the current state
	 * @param isAttemptCompletionMessage - Whether this checkpoint is for an attempt completion message
	 * @param taskIsFavorited - Whether the task is favorited (passed from Task class)
	 */
	async saveCheckpoint(
		isAttemptCompletionMessage: boolean = false,
		legacyCheckpointsHashStorage: boolean = true,
	): Promise<void> {
		if (!this.dependencies.enableCheckpoints) {
			console.log("Checkpoints are disabled")
			// If checkpoints are disabled, do nothing.
			return
		}

		const clineMessages = this.dependencies.messageStateHandler.getClineMessages()

		// Set isCheckpointCheckedOut to false for all checkpoint_created messages
		if (legacyCheckpointsHashStorage === true) {
			clineMessages.forEach((message) => {
				if (message.say === "checkpoint_created") {
					message.isCheckpointCheckedOut = false
				}
			})
		} else {
			console.log("TESTING - Using new checkpoints commit hash storage method (not yet implemented)")
		}

		if (!isAttemptCompletionMessage) {
			// ensure we aren't creating a duplicate checkpoint

			const lastMessage = clineMessages.at(-1)
			if (lastMessage?.say === "checkpoint_created") {
				return
			}

			// If checkpointTracker is not initialized and we have no error for it, we will initialize it.
			if (!this.state.checkpointTracker && !this.state.checkpointTrackerErrorMessage) {
				try {
					await this.checkpointTrackerCheckAndInit()
				} catch (error) {
					// If there is an error initializing checpoints, we want to set the checkpointTrackerErrorMessage for future use
					console.error("Error initializing checkpoint")
					const errorMessage = error instanceof Error ? error.message : "Unknown Error"
					this.setCheckpointTrackerErrorMessage(errorMessage)
					// TODO - Do we need to postState to webview here? TBD
				}
			}

			// For non-attempt completion we just say checkpoints
			await this.dependencies.say("checkpoint_created")
			this.state.checkpointTracker?.commit().then(async (commitHash) => {
				const lastCheckpointMessage = findLast(
					this.dependencies.messageStateHandler.getClineMessages(),
					(m) => m.say === "checkpoint_created",
				)
				if (lastCheckpointMessage) {
					lastCheckpointMessage.lastCheckpointHash = commitHash
					await this.dependencies.messageStateHandler.saveClineMessagesAndUpdateHistory()
				}
			}) // silently fails for now

			//
		} else {
			// attempt completion requires checkpoint to be sync so that we can present button after attempt_completion
			// Check if checkpoint tracker exists, if not, create it
			if (!this.state.checkpointTracker) {
				try {
					await this.checkpointTrackerCheckAndInit()
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error"
					console.error("Failed to initialize checkpoint tracker for attempt completion:", errorMessage)
					return
				}
			}

			if (this.state.checkpointTracker) {
				const commitHash = await this.state.checkpointTracker.commit()

				// For attempt_completion, find the last completion_result message and set its checkpoint hash. This will be used to present the 'see new changes' button
				const lastCompletionResultMessage = findLast(
					this.dependencies.messageStateHandler.getClineMessages(),
					(m) => m.say === "completion_result" || m.ask === "completion_result",
				)
				if (lastCompletionResultMessage) {
					lastCompletionResultMessage.lastCheckpointHash = commitHash
					await this.dependencies.messageStateHandler.saveClineMessagesAndUpdateHistory()
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
	 */
	async restoreCheckpoint(messageTs: number, restoreType: ClineCheckpointRestore, offset?: number): Promise<void> {
		const clineMessages = this.dependencies.messageStateHandler.getClineMessages()
		const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs) - (offset || 0)
		// Find the last message before messageIndex that has a lastCheckpointHash
		const lastHashIndex = findLastIndex(clineMessages.slice(0, messageIndex), (m) => m.lastCheckpointHash !== undefined)
		const message = clineMessages[messageIndex]
		const lastMessageWithHash = clineMessages[lastHashIndex]

		if (!message) {
			console.error("Message not found", clineMessages)
			return
		}

		let didWorkspaceRestoreFail = false

		switch (restoreType) {
			case "task":
				break
			case "taskAndWorkspace":
			case "workspace":
				if (!this.dependencies.enableCheckpoints) {
					vscode.window.showErrorMessage("Checkpoints are disabled in settings.")
					didWorkspaceRestoreFail = true
					break
				}

				if (!this.state.checkpointTracker && !this.state.checkpointTrackerErrorMessage) {
					try {
						this.state.checkpointTracker = await CheckpointTracker.create(
							this.dependencies.taskId,
							this.dependencies.context.globalStorageUri.fsPath,
							this.dependencies.enableCheckpoints,
						)
						this.dependencies.messageStateHandler.setCheckpointTracker(this.state.checkpointTracker)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : "Unknown error"
						console.error("Failed to initialize checkpoint tracker:", errorMessage)
						this.state.checkpointTrackerErrorMessage = errorMessage
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

		if (!didWorkspaceRestoreFail) {
			await this.handleSuccessfulRestore(restoreType, message, messageIndex, messageTs)
		} else {
			sendRelinquishControlEvent()
		}
	}

	/**
	 * Presents a multi-file diff view between checkpoints
	 * @param messageTs - Timestamp of the message to show diff for
	 * @param seeNewChangesSinceLastTaskCompletion - Whether to show changes since last completion
	 */
	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean) {
		const relinquishButton = () => {
			sendRelinquishControlEvent()
		}
		if (!this.dependencies.enableCheckpoints) {
			vscode.window.showInformationMessage("Checkpoints are disabled in settings. Cannot show diff.")
			relinquishButton()
			return
		}

		console.log("presentMultifileDiff", messageTs)
		const clineMessages = this.dependencies.messageStateHandler.getClineMessages()
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
		if (!this.state.checkpointTracker && this.dependencies.enableCheckpoints && !this.state.checkpointTrackerErrorMessage) {
			try {
				this.state.checkpointTracker = await CheckpointTracker.create(
					this.dependencies.taskId,
					this.dependencies.context.globalStorageUri.fsPath,
					this.dependencies.enableCheckpoints,
				)
				this.dependencies.messageStateHandler.setCheckpointTracker(this.state.checkpointTracker)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				this.state.checkpointTrackerErrorMessage = errorMessage
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
					this.dependencies.messageStateHandler.getClineMessages().slice(0, messageIndex),
					(m) => m.say === "completion_result",
				)?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about
				// if undefined, then we get diff from beginning of git
				// if (!lastTaskCompletedMessage) {
				// 	console.error("No previous task completion message found")
				// 	return
				// }
				// This value *should* always exist
				const firstCheckpointMessageCheckpointHash = this.dependencies.messageStateHandler
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
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		if (!this.dependencies.enableCheckpoints) {
			return false
		}

		const clineMessages = this.dependencies.messageStateHandler.getClineMessages()
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

		if (this.dependencies.enableCheckpoints && !this.state.checkpointTracker && !this.state.checkpointTrackerErrorMessage) {
			try {
				this.state.checkpointTracker = await CheckpointTracker.create(
					this.dependencies.taskId,
					this.dependencies.context.globalStorageUri.fsPath,
					this.dependencies.enableCheckpoints,
				)
				this.dependencies.messageStateHandler.setCheckpointTracker(this.state.checkpointTracker)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error("Failed to initialize checkpoint tracker:", errorMessage)
				return false
			}
		}

		// Get last task completed
		const lastTaskCompletedMessage = findLast(
			this.dependencies.messageStateHandler.getClineMessages().slice(0, messageIndex),
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
			const firstCheckpointMessageCheckpointHash = this.dependencies.messageStateHandler
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

				const apiConversationHistory = this.dependencies.messageStateHandler.getApiConversationHistory()
				const newConversationHistory = apiConversationHistory.slice(0, (message.conversationHistoryIndex || 0) + 2) // +1 since this index corresponds to the last user message, and another +1 since slice end index is exclusive
				await this.dependencies.messageStateHandler.overwriteApiConversationHistory(newConversationHistory)

				// update the context history state - we need to import the required functions
				const { ContextManager } = await import("@core/context/context-management/ContextManager")
				const contextManager = new ContextManager()
				await contextManager.truncateContextHistory(
					message.ts,
					await ensureTaskDirectoryExists(this.getContext(), this.dependencies.taskId),
				)

				// aggregate deleted api reqs info so we don't lose costs/tokens
				const clineMessages = this.dependencies.messageStateHandler.getClineMessages()
				const deletedMessages = clineMessages.slice(messageIndex + 1)
				const { getApiMetrics } = await import("@shared/getApiMetrics")
				const { combineApiRequests } = await import("@shared/combineApiRequests")
				const { combineCommandSequences } = await import("@shared/combineCommandSequences")
				const deletedApiReqsMetrics = getApiMetrics(combineApiRequests(combineCommandSequences(deletedMessages)))

				// Note: File context warning detection is handled by the Task class
				// since FileContextTracker is not available in checkpoint manager dependencies
				// TODO REVIEW TO CONFIRM THIS IS COOL BRO

				const newClineMessages = clineMessages.slice(0, messageIndex + 1)
				await this.dependencies.messageStateHandler.overwriteClineMessages(newClineMessages) // calls saveClineMessages which saves historyItem

				await this.dependencies.say(
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
			const checkpointMessages = this.dependencies.messageStateHandler
				.getClineMessages()
				.filter((m) => m.say === "checkpoint_created")
			const currentMessageIndex = checkpointMessages.findIndex((m) => m.ts === messageTs)

			// Set isCheckpointCheckedOut to false for all checkpoint messages
			checkpointMessages.forEach((m, i) => {
				m.isCheckpointCheckedOut = i === currentMessageIndex
			})
		}

		await this.dependencies.messageStateHandler.saveClineMessagesAndUpdateHistory()

		// Cancel and reinitialize the task to get updated messages
		await this.dependencies.cancelTask()
	}

	// ============================================================================
	// State management - interface for updating internal state
	// ============================================================================

	/**
	 * Checks for an active checkpoint tracker instance, creates if needed
	 * Uses promise-based synchronization to prevent race conditions when called concurrently
	 */
	async checkpointTrackerCheckAndInit(): Promise<CheckpointTracker | undefined> {
		// If tracker already exists or there was an error, return immediately
		if (this.state.checkpointTracker || this.state.checkpointTrackerErrorMessage) {
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
				this.dependencies.taskId,
				this.dependencies.context.globalStorageUri.fsPath,
				this.dependencies.enableCheckpoints,
			)

			// Update the state with the created tracker
			this.state.checkpointTracker = tracker
			return tracker
		} catch (error) {
			// Store error message to prevent future initialization attempts
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			this.state.checkpointTrackerErrorMessage = errorMessage
			console.error("Failed to initialize checkpoint tracker:", errorMessage)
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
	setCheckpointTrackerErrorMessage(errorMessage: string | undefined): void {
		this.state.checkpointTrackerErrorMessage = errorMessage
	}

	/**
	 * Updates the conversation history deleted range
	 */
	updateConversationHistoryDeletedRange(range: [number, number] | undefined): void {
		this.state.conversationHistoryDeletedRange = range
	}

	// ============================================================================
	// Internal utilities - Private helpers for checkpoint operations
	// ============================================================================

	/**
	 * Gets the extension context with proper error handling
	 */
	private getContext(): vscode.ExtensionContext {
		if (!this.dependencies.context) {
			throw new Error("Unable to access extension context")
		}
		return this.dependencies.context
	}

	/**
	 * Provides read-only access to current state for internal operations
	 */
	private get currentState(): Readonly<CheckpointManagerState> {
		return Object.freeze({ ...this.state })
	}

	/**
	 * Provides public read-only access to current state
	 */
	public getCurrentState(): Readonly<CheckpointManagerState> {
		return Object.freeze({ ...this.state })
	}

	/**
	 * Provides read-only access to dependencies for internal operations
	 */
	private get deps(): Readonly<CheckpointManagerDependencies> {
		return this.dependencies
	}
}

// ============================================================================
// Factory function for clean instantiation
// ============================================================================

/**
 * Creates a new TaskCheckpointManager instance
 */
export function createTaskCheckpointManager(
	dependencies: CheckpointManagerDependencies,
	initialState: CheckpointManagerState,
): TaskCheckpointManager {
	return new TaskCheckpointManager(dependencies, initialState)
}
