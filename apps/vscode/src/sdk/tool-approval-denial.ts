export const USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON = "Tool execution was cancelled because the user sent a follow-up message."

export function isUserMessageToolApprovalDenial(value: unknown): boolean {
	if (typeof value === "string") {
		return value.includes(USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON)
	}

	if (value instanceof Error) {
		return value.message.includes(USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON)
	}

	if (value && typeof value === "object" && "message" in value) {
		const message = (value as { message?: unknown }).message
		return typeof message === "string" && message.includes(USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON)
	}

	return false
}
