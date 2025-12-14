import CheckpointTracker from "@integrations/checkpoints/CheckpointTracker"
import { findLast } from "@shared/array"
import { Empty } from "@shared/proto/cline/common"
import { ExplainChangesRequest } from "@shared/proto/cline/task"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Controller } from ".."
import { sendRelinquishControlEvent } from "../ui/subscribeToRelinquishControl"
import {
	buildDiffContent,
	openDiffView,
	setupCommentController,
	streamAIExplanationComments,
	stringifyConversationHistory,
} from "./explainChangesShared"

/**
 * Explains the changes made by the AI and adds inline comments explaining them.
 *
 * This handler streams comments in real-time:
 * 1. Gets the diff from the checkpoint tracker
 * 2. Opens the diff view IMMEDIATELY so user sees progress
 * 3. Streams the AI response and adds comments as they're generated
 * 4. Each comment appears in the diff view as soon as it's parsed
 */
export async function explainChanges(controller: Controller, request: ExplainChangesRequest): Promise<Empty> {
	const relinquishButton = () => {
		sendRelinquishControlEvent()
	}

	try {
		// Validate we have an active task with checkpoint manager
		if (!controller.task) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "No active task",
			})
			relinquishButton()
			return Empty.create({})
		}

		const checkpointManager = controller.task.checkpointManager as any
		if (!checkpointManager) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Checkpoints not enabled",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Check if checkpoints are enabled
		if (!checkpointManager.config?.enableCheckpoints) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "Checkpoints are disabled in settings. Cannot review changes.",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Get message state handler
		const messageStateHandler = checkpointManager.services?.messageStateHandler
		if (!messageStateHandler) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Message state handler not available",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Find the message
		const clineMessages = messageStateHandler.getClineMessages()
		const messageIndex = clineMessages.findIndex((m: any) => m.ts === request.messageTs)
		const message = clineMessages[messageIndex]

		if (!message) {
			console.error(`[explainChanges] Message not found for timestamp ${request.messageTs}`)
			relinquishButton()
			return Empty.create({})
		}

		const hash = message.lastCheckpointHash
		if (!hash) {
			console.error(`[explainChanges] No checkpoint hash found for message ${request.messageTs}`)
			relinquishButton()
			return Empty.create({})
		}

		// Initialize checkpoint tracker if needed (same logic as presentMultifileDiff)
		if (
			!checkpointManager.state?.checkpointTracker &&
			checkpointManager.config?.enableCheckpoints &&
			!checkpointManager.state?.checkpointManagerErrorMessage
		) {
			try {
				const workspacePath = await checkpointManager.getWorkspacePath()
				checkpointManager.state.checkpointTracker = await CheckpointTracker.create(
					checkpointManager.task.taskId,
					checkpointManager.config.enableCheckpoints,
					workspacePath,
				)
				messageStateHandler.setCheckpointTracker(checkpointManager.state.checkpointTracker)
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Unknown error"
				console.error(`[explainChanges] Failed to initialize checkpoint tracker:`, errorMessage)
				checkpointManager.state.checkpointManagerErrorMessage = errorMessage
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: errorMessage,
				})
				relinquishButton()
				return Empty.create({})
			}
		}

		const checkpointTracker = checkpointManager.state?.checkpointTracker as CheckpointTracker | undefined
		if (!checkpointTracker) {
			console.error(`[explainChanges] Checkpoint tracker not available`)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Checkpoint tracker not available",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Get changed files (using seeNewChangesSinceLastTaskCompletion logic)
		const lastTaskCompletedMessageCheckpointHash = findLast(
			clineMessages.slice(0, messageIndex),
			(m: any) => m.say === "completion_result",
		)?.lastCheckpointHash

		const firstCheckpointMessageCheckpointHash = clineMessages.find(
			(m: any) => m.say === "checkpoint_created",
		)?.lastCheckpointHash

		const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash

		if (!previousCheckpointHash) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Unexpected error: No checkpoint hash found",
			})
			relinquishButton()
			return Empty.create({})
		}

		const changedFiles = await checkpointTracker.getDiffSet(previousCheckpointHash, hash)
		if (!changedFiles?.length) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "No changes found to review",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Get API configuration
		const apiConfiguration = controller.stateManager.getApiConfiguration()
		if (!apiConfiguration) {
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "API configuration not available",
			})
			relinquishButton()
			return Empty.create({})
		}

		// Get conversation summary for context
		const apiConversationHistory = messageStateHandler.getApiConversationHistory()
		const conversationSummary = stringifyConversationHistory(apiConversationHistory)

		// Set up the comment controller with reply handler
		const commentController = await setupCommentController(apiConfiguration, changedFiles, conversationSummary)

		// Build the diff content for the AI
		const diffContent = buildDiffContent(changedFiles)

		// For 3+ files, cycle through each file showing comments as they stream
		// For 2 or fewer files, just open the multi-diff view directly
		const shouldRevealComments = changedFiles.length >= 3

		// If 2 or fewer files, open the diff view first so user sees it immediately
		if (!shouldRevealComments) {
			await openDiffView("Explain Changes", changedFiles)
		}

		// Capture reference to the task for abort checking
		const task = controller.task

		// Stream AI explanation comments and add them as they arrive
		// Each comment will open its virtual doc and scroll to show the comment (if 3+ files)
		await streamAIExplanationComments(
			apiConfiguration,
			diffContent,
			conversationSummary,
			changedFiles,
			// onCommentStart: Create the comment UI immediately when we know the location
			(filePath, startLine, endLine) => {
				const matchingFile = changedFiles.find((f) => f.absolutePath === filePath)
				commentController.startStreamingComment(
					filePath,
					startLine,
					endLine,
					matchingFile?.relativePath,
					matchingFile?.after,
					shouldRevealComments, // Only cycle through files if 3+ files
				)
			},
			// onCommentChunk: Append text as it streams in
			(chunk) => {
				commentController.appendToStreamingComment(chunk)
			},
			// onCommentEnd: Finalize the comment
			() => {
				commentController.endStreamingComment()
			},
			// shouldAbort: Check if task was cancelled
			() => task?.taskState?.abort === true,
		)

		// Check if we were aborted during streaming
		if (task?.taskState?.abort) {
			// Close diff views and clear comments when cancelled
			commentController.clearAllComments()
			await commentController.closeDiffViews()
			relinquishButton()
			return Empty.create({})
		}

		// After all comments are done, open the multi-diff view to show everything together (if 3+ files)
		if (shouldRevealComments) {
			await openDiffView("Explain Changes", changedFiles)
		}

		// Relinquish button after comments are done
		relinquishButton()
		return Empty.create({})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		console.error("Error in explainChanges:", errorMessage)
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to explain changes: " + errorMessage,
		})
		sendRelinquishControlEvent()
		return Empty.create({})
	}
}
