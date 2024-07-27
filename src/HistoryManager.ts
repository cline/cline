import * as vscode from "vscode"
import { ClaudeMessage } from "./shared/ExtensionMessage"
import { MessageFormatter } from "./MessageFormatter"

export interface Message {
	role: string
	content: string
}

export interface Task {
	id: string
	description: string
	timestamp: number
	messages: Message[]
}

export class TaskHistoryManager {
	private context: vscode.ExtensionContext
	private tasks: Task[]
	private messageFormatter: MessageFormatter

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.tasks = this.loadTasks()
		this.messageFormatter = new MessageFormatter()
	}

	private loadTasks(): Task[] {
		return this.context.globalState.get<Task[]>("taskHistory", [])
	}

	private saveTasks(): void {
		this.context.globalState.update("taskHistory", this.tasks)
	}

	addTask(description: string, messages: Message[]): void {
		const newTask: Task = {
			id: Date.now().toString(),
			description,
			timestamp: Date.now(),
			messages,
		}
		this.tasks.unshift(newTask)
		this.saveTasks()
	}

	getTasks(): Task[] {
		return this.tasks
	}

	getTaskById(id: string): Task | undefined {
		return this.tasks.find((task) => task.id === id)
	}

	updateTaskMessages(id: string, messages: Message[]): void {
		const taskIndex = this.tasks.findIndex((task) => task.id === id)
		if (taskIndex !== -1) {
			this.tasks[taskIndex].messages = messages
			this.saveTasks()
		}
	}

	addMessageToTaskHistory(taskId: string | null, message: ClaudeMessage): void {
		if (taskId) {
			const currentTask = this.getTaskById(taskId)
			if (currentTask) {
				currentTask.messages.push(this.messageFormatter.formatMessageForHistory(message))
				this.updateTaskMessages(taskId, currentTask.messages)
			}
		}
	}

	clearHistory(): void {
		this.tasks = []
		this.saveTasks()
	}
}
