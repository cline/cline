import type { Socket } from "socket.io-client"

import {
	type ClineMessage,
	type TaskEvents,
	type TaskLike,
	type TaskBridgeCommand,
	type TaskBridgeEvent,
	RooCodeEventName,
	TaskBridgeEventName,
	TaskBridgeCommandName,
	TaskSocketEvents,
} from "@roo-code/types"

type TaskEventListener = {
	[K in keyof TaskEvents]: (...args: TaskEvents[K]) => void | Promise<void>
}[keyof TaskEvents]

const TASK_EVENT_MAPPING: Record<TaskBridgeEventName, keyof TaskEvents> = {
	[TaskBridgeEventName.Message]: RooCodeEventName.Message,
	[TaskBridgeEventName.TaskModeSwitched]: RooCodeEventName.TaskModeSwitched,
	[TaskBridgeEventName.TaskInteractive]: RooCodeEventName.TaskInteractive,
}

export class TaskManager {
	private subscribedTasks: Map<string, TaskLike> = new Map()
	private pendingTasks: Map<string, TaskLike> = new Map()
	private socket: Socket | null = null

	private taskListeners: Map<string, Map<TaskBridgeEventName, TaskEventListener>> = new Map()

	constructor() {}

	public async onConnect(socket: Socket): Promise<void> {
		this.socket = socket

		// Rejoin all subscribed tasks.
		for (const taskId of this.subscribedTasks.keys()) {
			try {
				socket.emit(TaskSocketEvents.JOIN, { taskId })

				console.log(`[TaskManager] emit() -> ${TaskSocketEvents.JOIN} ${taskId}`)
			} catch (error) {
				console.error(
					`[TaskManager] emit() failed -> ${TaskSocketEvents.JOIN}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}

		// Subscribe to any pending tasks.
		for (const task of this.pendingTasks.values()) {
			await this.subscribeToTask(task, socket)
		}

		this.pendingTasks.clear()
	}

	public onDisconnect(): void {
		this.socket = null
	}

	public async onReconnect(socket: Socket): Promise<void> {
		this.socket = socket

		// Rejoin all subscribed tasks.
		for (const taskId of this.subscribedTasks.keys()) {
			try {
				socket.emit(TaskSocketEvents.JOIN, { taskId })

				console.log(`[TaskManager] emit() -> ${TaskSocketEvents.JOIN} ${taskId}`)
			} catch (error) {
				console.error(
					`[TaskManager] emit() failed -> ${TaskSocketEvents.JOIN}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}
	}

	public async cleanup(socket: Socket | null): Promise<void> {
		if (!socket) {
			return
		}

		const unsubscribePromises = []

		for (const taskId of this.subscribedTasks.keys()) {
			unsubscribePromises.push(this.unsubscribeFromTask(taskId, socket))
		}

		await Promise.allSettled(unsubscribePromises)
		this.subscribedTasks.clear()
		this.taskListeners.clear()
		this.pendingTasks.clear()
		this.socket = null
	}

	public addPendingTask(task: TaskLike): void {
		this.pendingTasks.set(task.taskId, task)
	}

	public async subscribeToTask(task: TaskLike, socket: Socket): Promise<void> {
		const taskId = task.taskId
		this.subscribedTasks.set(taskId, task)
		this.setupListeners(task)

		try {
			socket.emit(TaskSocketEvents.JOIN, { taskId })
			console.log(`[TaskManager] emit() -> ${TaskSocketEvents.JOIN} ${taskId}`)
		} catch (error) {
			console.error(
				`[TaskManager] emit() failed -> ${TaskSocketEvents.JOIN}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	public async unsubscribeFromTask(taskId: string, socket: Socket): Promise<void> {
		const task = this.subscribedTasks.get(taskId)

		if (task) {
			this.removeListeners(task)
			this.subscribedTasks.delete(taskId)
		}

		try {
			socket.emit(TaskSocketEvents.LEAVE, { taskId })

			console.log(`[TaskManager] emit() -> ${TaskSocketEvents.LEAVE} ${taskId}`)
		} catch (error) {
			console.error(
				`[TaskManager] emit() failed -> ${TaskSocketEvents.LEAVE}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	public handleTaskCommand(message: TaskBridgeCommand): void {
		const task = this.subscribedTasks.get(message.taskId)

		if (!task) {
			console.error(`[TaskManager#handleTaskCommand] Unable to find task ${message.taskId}`)

			return
		}

		switch (message.type) {
			case TaskBridgeCommandName.Message:
				console.log(
					`[TaskManager#handleTaskCommand] ${TaskBridgeCommandName.Message} ${message.taskId} -> submitUserMessage()`,
					message,
				)

				task.submitUserMessage(message.payload.text, message.payload.images)
				break
			case TaskBridgeCommandName.ApproveAsk:
				console.log(
					`[TaskManager#handleTaskCommand] ${TaskBridgeCommandName.ApproveAsk} ${message.taskId} -> approveAsk()`,
					message,
				)

				task.approveAsk(message.payload)
				break
			case TaskBridgeCommandName.DenyAsk:
				console.log(
					`[TaskManager#handleTaskCommand] ${TaskBridgeCommandName.DenyAsk} ${message.taskId} -> denyAsk()`,
					message,
				)

				task.denyAsk(message.payload)
				break
		}
	}

	private setupListeners(task: TaskLike): void {
		if (this.taskListeners.has(task.taskId)) {
			console.warn("[TaskManager] Listeners already exist for task, removing old listeners:", task.taskId)

			this.removeListeners(task)
		}

		const listeners = new Map<TaskBridgeEventName, TaskEventListener>()

		const onMessage = ({ action, message }: { action: string; message: ClineMessage }) => {
			this.publishEvent({
				type: TaskBridgeEventName.Message,
				taskId: task.taskId,
				action,
				message,
			})
		}

		task.on(RooCodeEventName.Message, onMessage)
		listeners.set(TaskBridgeEventName.Message, onMessage)

		const onTaskModeSwitched = (mode: string) => {
			this.publishEvent({
				type: TaskBridgeEventName.TaskModeSwitched,
				taskId: task.taskId,
				mode,
			})
		}

		task.on(RooCodeEventName.TaskModeSwitched, onTaskModeSwitched)
		listeners.set(TaskBridgeEventName.TaskModeSwitched, onTaskModeSwitched)

		const onTaskInteractive = (_taskId: string) => {
			this.publishEvent({
				type: TaskBridgeEventName.TaskInteractive,
				taskId: task.taskId,
			})
		}

		task.on(RooCodeEventName.TaskInteractive, onTaskInteractive)

		listeners.set(TaskBridgeEventName.TaskInteractive, onTaskInteractive)

		this.taskListeners.set(task.taskId, listeners)

		console.log("[TaskManager] Task listeners setup complete for:", task.taskId)
	}

	private removeListeners(task: TaskLike): void {
		const listeners = this.taskListeners.get(task.taskId)

		if (!listeners) {
			return
		}

		console.log("[TaskManager] Removing task listeners for:", task.taskId)

		listeners.forEach((listener, eventName) => {
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				task.off(TASK_EVENT_MAPPING[eventName], listener as any)
			} catch (error) {
				console.error(
					`[TaskManager] Error removing listener for ${String(eventName)} on task ${task.taskId}:`,
					error,
				)
			}
		})

		this.taskListeners.delete(task.taskId)
	}

	private async publishEvent(message: TaskBridgeEvent): Promise<boolean> {
		if (!this.socket) {
			console.error("[TaskManager] publishEvent -> socket not available")
			return false
		}

		try {
			this.socket.emit(TaskSocketEvents.EVENT, message)

			if (message.type !== TaskBridgeEventName.Message) {
				console.log(
					`[TaskManager] emit() -> ${TaskSocketEvents.EVENT} ${message.taskId} ${message.type}`,
					message,
				)
			}

			return true
		} catch (error) {
			console.error(
				`[TaskManager] emit() failed -> ${TaskSocketEvents.EVENT}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)

			return false
		}
	}
}
