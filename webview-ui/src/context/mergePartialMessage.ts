import { findLastIndex } from "@shared/array"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import deepEqual from "fast-deep-equal"

export function mergePartialMessage(prevState: ExtensionState, partialMessage: ClineMessage): ExtensionState {
	const lastIndex = findLastIndex(prevState.clineMessages, (msg) => msg.ts === partialMessage.ts)
	if (lastIndex === -1) {
		return prevState
	}

	if (deepEqual(prevState.clineMessages[lastIndex], partialMessage)) {
		return prevState
	}

	const newClineMessages = [...prevState.clineMessages]
	newClineMessages[lastIndex] = partialMessage
	return { ...prevState, clineMessages: newClineMessages }
}
