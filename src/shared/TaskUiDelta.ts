import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"

/**
 * Narrow task metadata updates that can be streamed during active execution.
 *
 * Snapshots remain the canonical hydration/recovery source of truth. Deltas are
 * only valid for the active task and must be applied strictly in sequence.
 */
export type TaskUiMetadataDelta = Partial<
	Pick<ExtensionState, "currentFocusChainChecklist" | "backgroundCommandRunning" | "backgroundCommandTaskId">
>

/**
 * Task UI delta contract for active task execution.
 *
 * Sequencing contract:
 * - `taskId` scopes the delta to a specific active task.
 * - `sequence` must increase monotonically by exactly 1.
 * - Any gap, duplicate, or out-of-order delta must trigger snapshot resync.
 * - `task_state_resynced` signals the receiver to discard local sequencing state
 *   and rehydrate from the canonical full snapshot path.
 */
export type TaskUiDelta =
	| {
			type: "message_added"
			taskId: string
			sequence: number
			message: ClineMessage
	  }
	| {
			type: "message_updated"
			taskId: string
			sequence: number
			message: ClineMessage
	  }
	| {
			type: "message_deleted"
			taskId: string
			sequence: number
			messageTs: number
	  }
	| {
			type: "task_metadata_updated"
			taskId: string
			sequence: number
			metadata: TaskUiMetadataDelta
	  }
	| {
			type: "task_state_resynced"
			taskId: string
			sequence: number
	  }

export function isTaskUiDeltaMessageMutation(
	delta: TaskUiDelta,
): delta is Extract<TaskUiDelta, { type: "message_added" | "message_updated" | "message_deleted" }> {
	return delta.type === "message_added" || delta.type === "message_updated" || delta.type === "message_deleted"
}