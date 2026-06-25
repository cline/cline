import type { ClineMessage } from "@shared/ExtensionMessage"

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
		return previous.type === "ask" && (previous.ask === "followup" || previous.ask === "mistake_limit_reached")
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
