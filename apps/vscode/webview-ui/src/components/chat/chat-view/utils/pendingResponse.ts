import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import type { PendingResponse, PendingUserMessage } from "../types/chatTypes"

/** The rows the backend writes for text the user submitted. */
function isUserAuthored(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "task" || message.say === "user_feedback")
}

/**
 * A submission is confirmed by the user-authored row the backend writes for it. The row's
 * kind depends on how the backend handled the submission, not on where it was typed: a prompt
 * sent from a task that failed before it had a session starts a new task, so the optimistic
 * `user_feedback` bubble is confirmed by a `task` row.
 */
function sameOptimisticMessage(left: ClineMessage, right: ClineMessage): boolean {
	const leftImages = left.images ?? []
	const rightImages = right.images ?? []
	const leftFiles = left.files ?? []
	const rightFiles = right.files ?? []

	return (
		isUserAuthored(left) &&
		isUserAuthored(right) &&
		left.text === right.text &&
		leftImages.length === rightImages.length &&
		leftImages.every((image, index) => image === rightImages[index]) &&
		leftFiles.length === rightFiles.length &&
		leftFiles.every((file, index) => file === rightFiles[index])
	)
}

export function hasPendingMessageConfirmation(messages: ClineMessage[], pending: PendingUserMessage): boolean {
	return messages.some((message) => message.ts > pending.afterTs && sameOptimisticMessage(message, pending.message))
}

export function withPendingUserMessage(messages: ClineMessage[], pending: PendingUserMessage | undefined): ClineMessage[] {
	return !pending || hasPendingMessageConfirmation(messages, pending) ? messages : [...messages, pending.message]
}

/**
 * Keep the optimistic loader only until the backend acknowledges this submission.
 * TurnState sequence is authoritative when available; message growth is the legacy fallback.
 */
export function isPendingResponseUnconfirmed(
	pendingResponse: PendingResponse | undefined,
	turnState: TurnState | undefined,
	messageCount: number,
): boolean {
	if (!pendingResponse) {
		return false
	}
	if (turnState) {
		return pendingResponse.turnStateSeq !== undefined && turnState.seq <= pendingResponse.turnStateSeq
	}
	return messageCount <= pendingResponse.messageCount
}
