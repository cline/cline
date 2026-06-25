import { findCheckpointForRun, type CheckpointEntry } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"

export function isVisibleCheckpointUserMessage(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "task" || message.say === "user_feedback")
}

export function findVisibleCheckpointUserMessageByRun(
	messages: ClineMessage[],
	runCount: number,
): { message: ClineMessage; index: number } | undefined {
	let seenUsers = 0
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index]
		if (!isVisibleCheckpointUserMessage(message)) {
			continue
		}
		seenUsers += 1
		if (seenUsers === runCount) {
			return { message, index }
		}
	}
	return undefined
}

export function buildSdkCheckpointRows(input: {
	messages: ClineMessage[]
	checkpointHistory: readonly CheckpointEntry[]
	createTimestamp: () => number
}): ClineMessage[] {
	const { checkpointHistory, createTimestamp, messages } = input
	if (checkpointHistory.length === 0) {
		return messages.filter((message) => message.say !== "checkpoint_created")
	}

	const existingRowsByRun = new Map<number, ClineMessage>()
	for (const message of messages) {
		if (message.say !== "checkpoint_created") {
			continue
		}
		const runCount = message.conversationHistoryIndex
		if (typeof runCount === "number" && Number.isInteger(runCount) && runCount > 0) {
			existingRowsByRun.set(runCount, message)
		}
	}

	const withoutCheckpointRows = messages.filter((message) => message.say !== "checkpoint_created")
	const result: ClineMessage[] = []
	let userRunCount = 0
	for (const message of withoutCheckpointRows) {
		result.push(message)
		if (!isVisibleCheckpointUserMessage(message)) {
			continue
		}
		userRunCount += 1
		const checkpoint = findCheckpointForRun(checkpointHistory, userRunCount)
		if (!checkpoint) {
			continue
		}
		const existing = existingRowsByRun.get(userRunCount)
		result.push({
			...(existing ?? {
				ts: createTimestamp(),
				type: "say" as const,
				say: "checkpoint_created" as const,
				partial: false,
			}),
			lastCheckpointHash: checkpoint.ref,
			conversationHistoryIndex: userRunCount,
		})
	}
	return result
}
