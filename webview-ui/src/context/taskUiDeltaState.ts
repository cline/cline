import { findLastIndex } from "@shared/array"
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { TaskUiDelta } from "@shared/TaskUiDelta"

export type TaskUiDeltaApplicationResult =
	| { kind: "ignored"; nextSequence: number }
	| { kind: "resync"; nextSequence: number }
	| { kind: "applied"; nextSequence: number; state: ExtensionState }

export function applyTaskUiDeltaToState(
	state: ExtensionState,
	delta: TaskUiDelta,
	latestSequence: number,
): TaskUiDeltaApplicationResult {
	const expectedSequence = latestSequence + 1
	if (delta.sequence !== expectedSequence) {
		return { kind: "resync", nextSequence: latestSequence }
	}

	if (delta.taskId !== state.currentTaskItem?.id) {
		return { kind: "ignored", nextSequence: delta.sequence }
	}

	if (delta.type === "task_state_resynced") {
		return { kind: "resync", nextSequence: 0 }
	}

	if (delta.type === "message_deleted") {
		return {
			kind: "applied",
			nextSequence: delta.sequence,
			state: {
				...state,
				clineMessages: state.clineMessages.filter((message) => message.ts !== delta.messageTs),
			},
		}
	}

	const existingIndex = findLastIndex(state.clineMessages, (message) => message.ts === delta.message.ts)
	if (existingIndex === -1) {
		return {
			kind: "applied",
			nextSequence: delta.sequence,
			state: {
				...state,
				clineMessages: [...state.clineMessages, delta.message],
			},
		}
	}

	const clineMessages = [...state.clineMessages]
	clineMessages[existingIndex] = delta.message
	return {
		kind: "applied",
		nextSequence: delta.sequence,
		state: {
			...state,
			clineMessages,
		},
	}
}
