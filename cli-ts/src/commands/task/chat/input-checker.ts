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
