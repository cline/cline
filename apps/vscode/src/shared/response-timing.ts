import type { ClineMessage } from "./ExtensionMessage"

/** Only prose cards have response timing; tool activity and reasoning do not. */
export function isProseResponse(message: ClineMessage): boolean {
	return message.type === "say"
		? message.say === "text" || (message.say === "completion_result" && !!message.text)
		: message.ask === "plan_mode_respond" ||
				message.ask === "followup" ||
				(message.ask === "completion_result" && !!message.text)
}

/** Called at successful text finalization, never during abort cleanup or history load. */
export function responseCompletion(message: ClineMessage, now = Date.now()): Partial<ClineMessage> {
	return isProseResponse(message) && message.interruptedAt === undefined ? { completedAt: message.completedAt ?? now } : {}
}
