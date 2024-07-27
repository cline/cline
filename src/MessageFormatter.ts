import { ClaudeMessage } from "./shared/ExtensionMessage"
import { Message } from "./HistoryManager"
import { ClaudeAsk, ClaudeSay } from "./shared/ExtensionMessage"

export class MessageFormatter {
	formatMessageForHistory(message: ClaudeMessage): Message {
		let role: string
		let content: string

		switch (message.type) {
			case "ask":
				role = "human"
				content = message.text ?? ""
				break
			case "say":
				role = "assistant"
				content = message.text ?? ""
				break
			default:
				role = "system"
				content = JSON.stringify(message)
		}

		return { role, content }
	}

	convertHistoryMessagesToClaudeMessages(messages: Message[]): ClaudeMessage[] {
		return messages.map((message) => {
			const ts = Date.now()
			if (message.role === "human") {
				return { ts, type: "ask", ask: "text" as ClaudeAsk, text: message.content }
			} else if (message.role === "assistant") {
				return { ts, type: "say", say: "text" as ClaudeSay, text: message.content }
			} else {
				return { ts, type: "say", say: "system" as ClaudeSay, text: message.content }
			}
		})
	}
}
