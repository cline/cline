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
}

interface CheckpointManagerState {
	conversationHistoryDeletedRange?: [number, number]
	checkpointTracker?: CheckpointTracker
	checkpointTrackerErrorMessage?: string
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
					this.checkpointTrackerCheckAndInit()
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
					this.checkpointTrackerCheckAndInit()
					this.setCheckpointTracker(this.state.checkpointTracker)
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
		// TODO: Move restoreCheckpoint implementation here
		throw new Error("restoreCheckpoint not yet implemented - move from Task class")
	}

	/**
	 * Presents a multi-file diff view between checkpoints
	 * @param messageTs - Timestamp of the message to show diff for
	 * @param seeNewChangesSinceLastTaskCompletion - Whether to show changes since last completion
	 */
	async presentMultifileDiff(messageTs: number, seeNewChangesSinceLastTaskCompletion: boolean): Promise<void> {
		// TODO: Move presentMultifileDiff implementation here
		throw new Error("presentMultifileDiff not yet implemented - move from Task class")
	}

	/**
	 * Checks if the latest task completion has new changes
	 * @returns Promise<boolean> - True if there are new changes since last completion
	 */
	async doesLatestTaskCompletionHaveNewChanges(): Promise<boolean> {
		// TODO: Move doesLatestTaskCompletionHaveNewChanges implementation here
		throw new Error("doesLatestTaskCompletionHaveNewChanges not yet implemented - move from Task class")
	}

	// ============================================================================
	// State management - interface for updating internal state
	// ============================================================================

	/**
	 * Checks for an active checkpoint tracker instance, creates if needed
	 */
	async checkpointTrackerCheckAndInit(): Promise<CheckpointTracker | undefined> {
		//console.log("Checkpoint Tracker checkpointTrackerCheckAndInit")
		//console.log("Values: ", this.dependencies.taskId, this.dependencies.context.globalStorageUri.fsPath, this.dependencies.enableCheckpoints)

		if (!this.state.checkpointTracker && !this.state.checkpointTrackerErrorMessage) {
			const tracker = await CheckpointTracker.create(
				this.dependencies.taskId,
				this.dependencies.context.globalStorageUri.fsPath,
				this.dependencies.enableCheckpoints,
			)

			// Update the state with the created tracker
			this.state.checkpointTracker = tracker
			return tracker
		} else {
			// CheckpointTracker already exists or there was an error
			return this.state.checkpointTracker
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
 * Creates a new TaskCheckpointManager instance with proper dependency injection
 */
export function createTaskCheckpointManager(
	dependencies: CheckpointManagerDependencies,
	initialState: CheckpointManagerState,
): TaskCheckpointManager {
	return new TaskCheckpointManager(dependencies, initialState)
}
