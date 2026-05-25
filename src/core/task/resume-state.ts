import type { ClineAsk, ClineMessage, ClineSay } from "@shared/ExtensionMessage"

const RESUME_ASKS = new Set<ClineAsk>(["resume_task", "resume_completed_task"])
const HOOK_SAYS = new Set<ClineSay>(["hook_status", "hook_output_stream"])

function isResumeAsk(message: ClineMessage): boolean {
	return message.type === "ask" && message.ask !== undefined && RESUME_ASKS.has(message.ask)
}

function isHookMessage(message: ClineMessage): boolean {
	return message.type === "say" && message.say !== undefined && HOOK_SAYS.has(message.say)
}

export function getLastNonHookMessage(messages: ClineMessage[]): ClineMessage | undefined {
	return messages
		.slice()
		.reverse()
		.find((message) => !isHookMessage(message))
}

export function getLastTaskStateMessage(messages: ClineMessage[]): ClineMessage | undefined {
	return messages
		.slice()
		.reverse()
		.find((message) => !isResumeAsk(message) && !isHookMessage(message))
}

export function getResumeAskType(messages: ClineMessage[]): ClineAsk {
	const lastTaskStateMessage = getLastTaskStateMessage(messages)
	return lastTaskStateMessage?.ask === "completion_result" ? "resume_completed_task" : "resume_task"
}
