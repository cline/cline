import { ClineMessage } from "./roo-code"

export class MessageHistory {
	private readonly messages: Record<string, Record<number, ClineMessage>>
	private readonly list: Record<string, number[]>

	constructor() {
		this.messages = {}
		this.list = {}
	}

	public add(taskId: string, message: ClineMessage) {
		if (!this.messages[taskId]) {
			this.messages[taskId] = {}
		}

		this.messages[taskId][message.ts] = message

		if (!this.list[taskId]) {
			this.list[taskId] = []
		}

		this.list[taskId].push(message.ts)
	}

	public update(taskId: string, message: ClineMessage) {
		if (this.messages[taskId][message.ts]) {
			this.messages[taskId][message.ts] = message
		}
	}

	public getMessages(taskId: string) {
		return (this.list[taskId] ?? []).map((ts) => this.messages[taskId][ts]).filter(Boolean)
	}
}
