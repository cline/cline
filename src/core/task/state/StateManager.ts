import { TaskState } from "../TaskState"

export type TaskStateId =
	| "Ready"
	| "AwaitingUserInput"
	| "Streaming"
	| "ToolUsePendingApproval"
	| "ToolExecuting"
	| "AwaitingUserFeedback"
	| "Completed"
	| "Aborted"
	| "Error"

export type TaskEvent =
	| { type: "USER_MESSAGE_RECEIVED" }
	| { type: "API_STREAM_STARTED" }
	| { type: "API_CHUNK_TEXT" }
	| { type: "API_CHUNK_TOOL" }
	| { type: "TOOL_PARTIAL" }
	| { type: "TOOL_RESTRICTED" }
	| { type: "TOOL_APPROVED" }
	| { type: "TOOL_REJECTED" }
	| { type: "TOOL_RESULT_PUSHED" }
	| { type: "API_STREAM_FINISHED"; ok: boolean }
	| { type: "ATTEMPT_COMPLETION" }
	| { type: "ERROR_THROWN" }
	| { type: "ABORT_REQUESTED" }
	| { type: "CANCELLED" }
	| { type: "CHECKPOINT_RESTORED" }

/**
 * StateManager (shell)
 * - Non-enforcing observer by default.
 * - Future: add guarded transitions and side-effect hooks.
 */
export class StateManager {
	private current: TaskStateId = "Ready"

	constructor(private readonly taskState: TaskState) {}

	getState(): TaskStateId {
		return this.current
	}

	/**
	 * For now, allow all transitions (observer mode).
	 * Future phases will enforce a transition table.
	 */
	canTransition(_to: TaskStateId): boolean {
		return true
	}

	/**
	 * Shell dispatch: only updates the state superficially for now.
	 * No side-effects; safe to drop-in without changing behavior.
	 */
	async dispatch(event: TaskEvent): Promise<void> {
		switch (event.type) {
			case "USER_MESSAGE_RECEIVED":
				this.current = "AwaitingUserInput"
				break
			case "API_STREAM_STARTED":
				this.current = "Streaming"
				break
			case "API_CHUNK_TEXT":
				// stay in Streaming
				break
			case "API_CHUNK_TOOL":
				this.current = "ToolUsePendingApproval"
				break
			case "TOOL_APPROVED":
				this.current = "ToolExecuting"
				break
			case "TOOL_REJECTED":
				this.current = "AwaitingUserFeedback"
				break
			case "TOOL_RESULT_PUSHED":
				this.current = "Streaming"
				break
			case "API_STREAM_FINISHED":
				this.current = event.ok ? "Completed" : "Error"
				break
			case "ATTEMPT_COMPLETION":
				this.current = "Completed"
				break
			case "ERROR_THROWN":
				this.current = "Error"
				break
			case "ABORT_REQUESTED":
			case "CANCELLED":
				this.current = "Aborted"
				break
			case "CHECKPOINT_RESTORED":
				this.current = "Ready"
				break
			default:
				// keep current
				break
		}
	}
}
