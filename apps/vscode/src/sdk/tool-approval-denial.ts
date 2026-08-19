import { isEditTool } from "./sdk-tool-policies"

export const DEFAULT_TOOL_APPROVAL_DENIAL_REASON = "User denied the tool execution"
export const USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON = "Tool execution was cancelled because the user sent a follow-up message."
export const EDIT_TOOL_APPROVAL_DENIAL_REASON =
	"The user denied this edit. The file was NOT modified and still contains its original content."

/**
 * Builds the model-facing reason for a denied tool approval.
 *
 * For edit tools it must state explicitly that the file was NOT modified: a denial
 * that carries only the user's feedback (e.g. "make them bigger") reads like
 * iteration feedback on an applied change, and the model then builds its next
 * old_text against content that never landed on disk — drifting further out of
 * sync with the file on every retry.
 */
export function buildToolApprovalDenialReason(toolName: string | undefined, feedback: string | undefined): string {
	const denial = toolName && isEditTool(toolName) ? EDIT_TOOL_APPROVAL_DENIAL_REASON : DEFAULT_TOOL_APPROVAL_DENIAL_REASON
	const trimmedFeedback = feedback?.trim()
	if (!trimmedFeedback) {
		return denial
	}
	return `${denial} The user provided the following feedback:\n<feedback>\n${trimmedFeedback}\n</feedback>`
}

function getMessage(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value
	}

	if (value instanceof Error) {
		return value.message
	}

	if (value && typeof value === "object" && "message" in value) {
		const message = (value as { message?: unknown }).message
		return typeof message === "string" ? message : undefined
	}

	return undefined
}

export function isKnownToolApprovalDenial(value: unknown): boolean {
	const message = getMessage(value)
	if (!message) {
		return false
	}

	return (
		message.includes(USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON) ||
		message.includes(DEFAULT_TOOL_APPROVAL_DENIAL_REASON) ||
		message.includes(EDIT_TOOL_APPROVAL_DENIAL_REASON)
	)
}

export function isDeniedToolApprovalMistake(
	value: unknown,
	deniedApprovals: Iterable<{ toolName: string; reason: string }>,
): boolean {
	const message = getMessage(value)
	if (!message) {
		return false
	}

	if (isKnownToolApprovalDenial(message)) {
		return true
	}

	for (const { toolName, reason } of deniedApprovals) {
		if (message.includes(`[${toolName}]`) && message.includes(reason)) {
			return true
		}
	}

	return false
}
