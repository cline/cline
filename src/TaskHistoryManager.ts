import * as vscode from "vscode"
import { ClaudeMessage } from "./shared/ExtensionMessage"

export type Message = ClaudeMessage

export interface Task {
	id: string
	description: string
	timestamp: number
	messages: Message[]
}

export class TaskHistoryManager {
	private context: vscode.ExtensionContext
	private tasks: Task[]

	constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.tasks = this.loadTasks()
	}

	private loadTasks(): Task[] {
		const loadedTasks = this.context.globalState.get<Task[]>("taskHistory", [])
		console.log("Loaded tasks:", JSON.stringify(loadedTasks, null, 2))
		return loadedTasks
	}

	private saveTasks(): void {
		console.log("Saving tasks:", JSON.stringify(this.tasks, null, 2))
		this.context.globalState.update("taskHistory", this.tasks)
	}

	addTask(description: string, messages: Message[]): void {
		const newTask: Task = {
			id: Date.now().toString(),
			description,
			timestamp: Date.now(),
			messages,
		}
		console.log("Adding new task:", JSON.stringify(newTask, null, 2))
		this.tasks.unshift(newTask)
		this.saveTasks()
	}

	getTasks(): Task[] {
		return this.tasks
	}

	getTaskById(id: string): Task | undefined {
		const task = this.tasks.find((task) => task.id === id)
		console.log("Retrieved task by ID:", JSON.stringify(task, null, 2))
		return task
	}

	updateTaskMessages(id: string, messages: Message[]): void {
		const taskIndex = this.tasks.findIndex((task) => task.id === id)
		if (taskIndex !== -1) {
			console.log("Updating task messages:", JSON.stringify(messages, null, 2))
			this.tasks[taskIndex].messages = messages
			this.saveTasks()
		}
	}

	clearHistory(): void {
		this.tasks = []
		this.saveTasks()
	}
}
