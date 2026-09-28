import type { ClineMessage, WorkspaceRestoreAvailability } from "@shared/ExtensionMessage"

export function isVisibleCheckpointUserMessage(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "task" || message.say === "user_feedback")
}

export function isCheckpointAnswerMessage(messages: ClineMessage[], index: number): boolean {
	const message = messages[index]
	if (message?.type !== "say" || message.say !== "user_feedback") {
		return false
	}

	for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
		const previous = messages[cursor]
		if (previous.say === "checkpoint_created") {
			continue
		}
		if (previous.type === "ask") {
			return previous.ask === "followup" || previous.ask === "mistake_limit_reached"
		}
		if (isVisibleCheckpointUserMessage(previous)) {
			return false
		}
	}

	return false
}

export function isCheckpointRunUserMessage(messages: ClineMessage[], index: number): boolean {
	return isVisibleCheckpointUserMessage(messages[index]) && !isCheckpointAnswerMessage(messages, index)
}

export function getCheckpointRunCountForMessage(messages: ClineMessage[], targetIndex: number): number | undefined {
	if (!isCheckpointRunUserMessage(messages, targetIndex)) {
		return undefined
	}

	let runCount = 0
	for (let index = 0; index <= targetIndex; index += 1) {
		if (isCheckpointRunUserMessage(messages, index)) {
			runCount += 1
		}
	}
	return runCount
}

export function findVisibleCheckpointUserMessageByRun(
	messages: ClineMessage[],
	runCount: number,
): { message: ClineMessage; index: number } | undefined {
	let seenUsers = 0
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index]
		if (!isCheckpointRunUserMessage(messages, index)) {
			continue
		}
		seenUsers += 1
		if (seenUsers === runCount) {
			return { message, index }
		}
	}
	return undefined
}

/**
 * Resolves the workspace checkpoint that Reset Code would use for each
 * editable user message. This follows the same visible-message → persisted
 * message → run-count chain as editMessageAndRegenerate, then delegates the
 * checkpoint lookup rule to Core.
 */
export function buildWorkspaceRestoreAvailabilityByMessageTs(input: {
	clineMessages: ClineMessage[]
	getRunCountForUserOrdinal: (userOrdinal: number) => number | undefined
	hasCheckpointForRun: (runCount: number) => boolean
}): Record<number, WorkspaceRestoreAvailability> {
	const result: Record<number, WorkspaceRestoreAvailability> = {}
	let userOrdinal = 0

	for (let index = 0; index < input.clineMessages.length; index += 1) {
		const message = input.clineMessages[index]
		if (!isVisibleCheckpointUserMessage(message)) {
			continue
		}

		userOrdinal += 1
		if (!isCheckpointRunUserMessage(input.clineMessages, index)) {
			continue
		}

		const runCount = input.getRunCountForUserOrdinal(userOrdinal)
		const checkpointAvailable = runCount !== undefined && input.hasCheckpointForRun(runCount)

		result[message.ts] = checkpointAvailable ? { available: true } : { available: false, reason: "checkpoint_unavailable" }
	}

	return result
}
