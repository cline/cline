import type { ClineMessage } from "@shared/ExtensionMessage"
import type { SdkInitialMessages } from "./session-host"

type SdkMessage = SdkInitialMessages[number]

/**
 * Reconstructs a minimal SDK conversation from the task's UI transcript.
 *
 * Session rebuilds (e.g. a plan/act mode toggle) seed the replacement session
 * from committed history, but a turn aborted mid-flight is never committed:
 * when the toggle lands during a task's first turn — say while a command
 * approval is pending — both the SDK message store and the classic API history
 * are still empty, and the rebuilt session would start with no context at all.
 * The UI transcript still holds the exchange, so fall back to the text the
 * user and the model actually saw.
 *
 * Only plain-text turns are recoverable (tool_use/tool_result pairs cannot be
 * reconstructed from UI messages), which is exactly what an uncommitted first
 * turn contains: the task text, streamed assistant text, and any user feedback.
 */
export function buildFallbackInitialMessages(clineMessages: ClineMessage[]): SdkInitialMessages | undefined {
	const messages: SdkMessage[] = []
	for (const message of clineMessages) {
		if (message.type !== "say") {
			continue
		}
		const text = message.text?.trim()
		if (!text) {
			continue
		}
		let role: SdkMessage["role"]
		switch (message.say) {
			case "task":
			case "user_feedback":
				role = "user"
				break
			case "text":
				role = "assistant"
				break
			default:
				continue
		}
		const previous = messages[messages.length - 1]
		if (previous && previous.role === role && typeof previous.content === "string") {
			previous.content = `${previous.content}\n\n${text}`
		} else {
			messages.push({ role, content: text })
		}
	}
	// Conversations must open with a user turn; leading assistant text (no
	// recoverable task message) is not a usable seed.
	while (messages.length > 0 && messages[0].role === "assistant") {
		messages.shift()
	}
	return messages.length > 0 ? messages : undefined
}
