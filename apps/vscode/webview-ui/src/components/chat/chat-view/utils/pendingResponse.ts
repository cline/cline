import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import type { PendingResponse, PendingUserMessage } from "../types/chatTypes"

function sameOptimisticMessage(left: ClineMessage, right: ClineMessage): boolean {
	const leftImages = left.images ?? []
	const rightImages = right.images ?? []
	const leftFiles = left.files ?? []
	const rightFiles = right.files ?? []
	const optimisticSay = left.say === "task" || left.say === "user_feedback"

	return (
		left.type === "say" &&
		right.type === "say" &&
		optimisticSay &&
		left.say === right.say &&
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
