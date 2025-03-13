import { EventEmitter } from "events"
import * as vscode from "vscode"

import { ClineProvider } from "../core/webview/ClineProvider"

import { RooCodeAPI, RooCodeEvents, ConfigurationValues } from "./roo-code"
import { MessageHistory } from "./message-history"

export class API extends EventEmitter<RooCodeEvents> implements RooCodeAPI {
	private readonly outputChannel: vscode.OutputChannel
	private readonly provider: ClineProvider
	private readonly history: MessageHistory

	constructor(outputChannel: vscode.OutputChannel, provider: ClineProvider) {
		super()

		this.outputChannel = outputChannel
		this.provider = provider
		this.history = new MessageHistory()

		this.on("message", ({ taskId, action, message }) => {
			// if (message.type === "say") {
			// 	console.log("message", { taskId, action, message })
			// }

			if (action === "created") {
				this.history.add(taskId, message)
			} else if (action === "updated") {
				this.history.update(taskId, message)
			}
		})
	}

	public async startNewTask(text?: string, images?: string[]) {
		await this.provider.removeClineFromStack()
		await this.provider.postStateToWebview()
		await this.provider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await this.provider.postMessageToWebview({ type: "invoke", invoke: "newChat", text, images })

		const cline = await this.provider.initClineWithTask(text, images)
		cline.on("message", (message) => this.emit("message", { taskId: cline.taskId, ...message }))
		cline.on("taskStarted", () => this.emit("taskStarted", cline.taskId))
		cline.on("taskPaused", () => this.emit("taskPaused", cline.taskId))
		cline.on("taskUnpaused", () => this.emit("taskUnpaused", cline.taskId))
		cline.on("taskAborted", () => this.emit("taskAborted", cline.taskId))
		cline.on("taskSpawned", (taskId) => this.emit("taskSpawned", cline.taskId, taskId))

		return cline.taskId
	}

	public async clearCurrentTask(lastMessage?: string) {
		await this.provider.finishSubTask(lastMessage)
	}

	public async cancelCurrentTask() {
		await this.provider.cancelTask()
	}

	public async sendMessage(text?: string, images?: string[]) {
		await this.provider.postMessageToWebview({ type: "invoke", invoke: "sendMessage", text, images })
	}

	public async pressPrimaryButton() {
		await this.provider.postMessageToWebview({ type: "invoke", invoke: "primaryButtonClick" })
	}

	public async pressSecondaryButton() {
		await this.provider.postMessageToWebview({ type: "invoke", invoke: "secondaryButtonClick" })
	}

	public async setConfiguration(values: Partial<ConfigurationValues>) {
		await this.provider.setValues(values)
	}

	public isReady() {
		return this.provider.viewLaunched
	}

	public getMessages(taskId: string) {
		return this.history.getMessages(taskId)
	}
}
