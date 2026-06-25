export const DEFAULT_TOOL_APPROVAL_DENIAL_REASON = "User denied the tool execution"
export const USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON = "Tool execution was cancelled because the user sent a follow-up message."

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

	return message.includes(USER_MESSAGE_TOOL_APPROVAL_DENIAL_REASON) || message.includes(DEFAULT_TOOL_APPROVAL_DENIAL_REASON)
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
