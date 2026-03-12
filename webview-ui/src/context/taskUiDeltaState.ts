import { findLastIndex } from "@shared/array"
import type { ExtensionState } from "@shared/ExtensionMessage"
import type { TaskUiDelta } from "@shared/TaskUiDelta"
import deepEqual from "fast-deep-equal"

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

	if (delta.type === "task_metadata_updated") {
		const metadataChanged = Object.entries(delta.metadata).some(([key, value]) => {
			return !deepEqual(state[key as keyof ExtensionState], value)
		})
		if (!metadataChanged) {
			return { kind: "applied", nextSequence: delta.sequence, state }
		}

		return {
			kind: "applied",
			nextSequence: delta.sequence,
			state: {
				...state,
				...delta.metadata,
			},
		}
	}

	if (delta.type === "message_deleted") {
		const hasMessageToDelete = state.clineMessages.some((message) => message.ts === delta.messageTs)
		if (!hasMessageToDelete) {
			return {
				kind: "applied",
				nextSequence: delta.sequence,
				state,
			}
		}

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

	if (deepEqual(state.clineMessages[existingIndex], delta.message)) {
		return {
			kind: "applied",
			nextSequence: delta.sequence,
			state,
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
