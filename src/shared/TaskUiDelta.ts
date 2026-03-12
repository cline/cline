import type { ClineMessage } from "@shared/ExtensionMessage"

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
			type: "task_state_resynced"
			taskId: string
			sequence: number
	  }

export function isTaskUiDeltaMessageMutation(
	delta: TaskUiDelta,
): delta is Extract<TaskUiDelta, { type: "message_added" | "message_updated" | "message_deleted" }> {
	return delta.type === "message_added" || delta.type === "message_updated" || delta.type === "message_deleted"
}
