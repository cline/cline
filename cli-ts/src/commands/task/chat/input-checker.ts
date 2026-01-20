/**
 * Input state checker for chat REPL
 *
 * Analyzes message history to determine if user input is needed.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"

/**
 * Result of checking for pending input
 */
export interface PendingInputState {
	awaitingApproval: boolean
	awaitingInput: boolean
}

/**
 * Check if the last message requires user input
 */
export function checkForPendingInput(messages: ClineMessage[]): PendingInputState {
	if (messages.length === 0) {
		return { awaitingApproval: false, awaitingInput: false }
	}

	const lastMessage = messages[messages.length - 1]

	// Skip partial messages
	if (lastMessage.partial) {
		return { awaitingApproval: false, awaitingInput: false }
	}

	// Check if this is an "ask" type message
	if (lastMessage.type === "ask") {
		const ask = lastMessage.ask

		// These require approval (yes/no response)
		const approvalAsks = ["command", "tool", "browser_action_launch", "use_mcp_server"]

		// These require free-form input
		const inputAsks = ["followup", "plan_mode_respond", "act_mode_respond"]

		if (approvalAsks.includes(ask || "")) {
			return { awaitingApproval: true, awaitingInput: false }
		}

		if (inputAsks.includes(ask || "")) {
			return { awaitingApproval: false, awaitingInput: true }
		}

		// Special cases
		if (ask === "api_req_failed") {
			return { awaitingApproval: true, awaitingInput: false }
		}

		if (ask === "completion_result" || ask === "resume_task" || ask === "resume_completed_task") {
			return { awaitingApproval: false, awaitingInput: true }
		}
	}

	return { awaitingApproval: false, awaitingInput: false }
}

/**
 * Check if the last message indicates a failure state (for yolo mode)
 */
export function isFailureState(messages: ClineMessage[]): { isFailure: boolean; actionKey: string | null } {
	if (messages.length === 0) {
		return { isFailure: false, actionKey: null }
	}

	const lastMessage = messages[messages.length - 1]

	// Skip partial messages
	if (lastMessage.partial) {
		return { isFailure: false, actionKey: null }
	}

	// Check for failure indicators
	if (
		lastMessage.ask === "api_req_failed" ||
		lastMessage.ask === "mistake_limit_reached" ||
		lastMessage.say === "error" ||
		lastMessage.say === "diff_error"
	) {
		// Use the message text as the action key for tracking consecutive failures
		const actionKey = lastMessage.text || lastMessage.ask || lastMessage.say || "unknown"
		return { isFailure: true, actionKey }
	}

	return { isFailure: false, actionKey: null }
}

/**
 * Check if the last message indicates task completion (for yolo mode)
 */
export function isCompletionState(messages: ClineMessage[]): boolean {
	if (messages.length === 0) {
		return false
	}

	const lastMessage = messages[messages.length - 1]

	// Skip partial messages
	if (lastMessage.partial) {
		return false
	}

	return lastMessage.ask === "completion_result" || lastMessage.say === "completion_result"
}
