import { findLast } from "@/shared/array"
import { MessageStateHandler } from "./message-state"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import CheckpointTracker from "@/integrations/checkpoints/CheckpointTracker"

export async function showChangedFilesDiff(
	messageStateHandler: MessageStateHandler,
	checkpointTracker: CheckpointTracker,
	messageTs: number,
	seeNewChangesSinceLastTaskCompletion: boolean,
) {
	console.log("presentMultifileDiff", messageTs)
	const clineMessages = messageStateHandler.getClineMessages()
	const messageIndex = clineMessages.findIndex((m) => m.ts === messageTs)
	const message = clineMessages[messageIndex]
	if (!message) {
		console.error("Message not found")
		return
	}
	const lastCheckpointHash = message.lastCheckpointHash
	if (!lastCheckpointHash) {
		console.error("No checkpoint hash found")
		return
	}

	const changedFiles = await getChangedFiles(
		messageStateHandler,
		checkpointTracker,
		seeNewChangesSinceLastTaskCompletion,
		messageIndex,
		lastCheckpointHash,
	)
	if (!changedFiles.length) {
		return
	}
	const title = seeNewChangesSinceLastTaskCompletion ? "New changes" : "Changes since snapshot"
	const diffs = changedFiles.map((file) => ({
		filePath: file.absolutePath,
		leftContent: file.before,
		rightContent: file.after,
	}))
	HostProvider.diff.openMultiFileDiff({ title, diffs })
}

type ChangedFile = {
	relativePath: string
	absolutePath: string
	before: string
	after: string
}

async function getChangedFiles(
	messageStateHandler: MessageStateHandler,
	checkpointTracker: CheckpointTracker,
	changesSinceLastTaskCompletion: boolean,
	messageIndex: number,
	lastCheckpointHash: string,
): Promise<ChangedFile[]> {
	try {
		let changedFiles
		if (changesSinceLastTaskCompletion) {
			changedFiles = await getChangesSinceLastTaskCompletion(
				messageStateHandler,
				checkpointTracker,
				messageIndex,
				lastCheckpointHash,
			)
		} else {
			// Get changed files between current state and commit
			changedFiles = await checkpointTracker.getDiffSet(lastCheckpointHash)
		}
		if (!changedFiles.length) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: "No changes found",
			})
		}
		return changedFiles
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Failed to retrieve diff set: " + errorMessage,
		})
		return []
	}
}

async function getChangesSinceLastTaskCompletion(
	messageStateHandler: MessageStateHandler,
	checkpointTracker: CheckpointTracker,
	messageIndex: number,
	lastCheckpointHash: string,
): Promise<ChangedFile[]> {
	// Get last task completed
	const lastTaskCompletedMessageCheckpointHash = findLast(
		messageStateHandler.getClineMessages().slice(0, messageIndex),
		(m) => m.say === "completion_result",
	)?.lastCheckpointHash // ask is only used to relinquish control, its the last say we care about

	// This value *should* always exist
	const firstCheckpointMessageCheckpointHash = messageStateHandler
		.getClineMessages()
		.find((m) => m.say === "checkpoint_created")?.lastCheckpointHash

	// either use the diff between the first checkpoint and the task completion, or the diff
	// between the latest two task completions
	const previousCheckpointHash = lastTaskCompletedMessageCheckpointHash || firstCheckpointMessageCheckpointHash

	if (!previousCheckpointHash) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Unexpected error: No checkpoint hash found",
		})
		return []
	}

	// Get changed files between current state and commit
	return await checkpointTracker.getDiffSet(previousCheckpointHash, lastCheckpointHash)
}
