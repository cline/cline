import type { Socket } from "socket.io-client"

import {
	type ClineMessage,
	type TaskEvents,
	type TaskLike,
	type TaskBridgeCommand,
	type TaskBridgeEvent,
	type JoinResponse,
	type LeaveResponse,
	RooCodeEventName,
	TaskBridgeEventName,
	TaskBridgeCommandName,
	TaskSocketEvents,
} from "@roo-code/types"

import { type BaseChannelOptions, BaseChannel } from "./BaseChannel.js"

type TaskEventListener = {
	[K in keyof TaskEvents]: (...args: TaskEvents[K]) => void | Promise<void>
}[keyof TaskEvents]

type TaskEventMapping = {
	from: keyof TaskEvents
	to: TaskBridgeEventName
	createPayload: (task: TaskLike, ...args: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface TaskChannelOptions extends BaseChannelOptions {}

/**
 * Manages task-level communication channels.
 * Handles task subscriptions, messaging, and task-specific commands.
 */
export class TaskChannel extends BaseChannel<
	TaskBridgeCommand,
	TaskSocketEvents,
	TaskBridgeEvent | { taskId: string }
> {
	private subscribedTasks: Map<string, TaskLike> = new Map()
	private pendingTasks: Map<string, TaskLike> = new Map()
	private taskListeners: Map<string, Map<TaskBridgeEventName, TaskEventListener>> = new Map()

	private readonly eventMapping: readonly TaskEventMapping[] = [
		{
			from: RooCodeEventName.Message,
			to: TaskBridgeEventName.Message,
			createPayload: (task: TaskLike, data: { action: string; message: ClineMessage }) => ({
				type: TaskBridgeEventName.Message,
				taskId: task.taskId,
				action: data.action,
				message: data.message,
			}),
		},
		{
			from: RooCodeEventName.TaskModeSwitched,
			to: TaskBridgeEventName.TaskModeSwitched,
			createPayload: (task: TaskLike, mode: string) => ({
				type: TaskBridgeEventName.TaskModeSwitched,
				taskId: task.taskId,
				mode,
			}),
		},
		{
			from: RooCodeEventName.TaskInteractive,
			to: TaskBridgeEventName.TaskInteractive,
			createPayload: (task: TaskLike, _taskId: string) => ({
				type: TaskBridgeEventName.TaskInteractive,
				taskId: task.taskId,
			}),
		},
	] as const

	constructor(options: TaskChannelOptions) {
		super(options)
	}

	protected async handleCommandImplementation(command: TaskBridgeCommand): Promise<void> {
		const task = this.subscribedTasks.get(command.taskId)

		if (!task) {
			console.error(`[TaskChannel] Unable to find task ${command.taskId}`)
			return
		}

		switch (command.type) {
			case TaskBridgeCommandName.Message:
				console.log(
					`[TaskChannel] ${TaskBridgeCommandName.Message} ${command.taskId} -> submitUserMessage()`,
					command,
				)

				await task.submitUserMessage(
					command.payload.text,
					command.payload.images,
					command.payload.mode,
					command.payload.providerProfile,
				)

				break

			case TaskBridgeCommandName.ApproveAsk:
				console.log(
					`[TaskChannel] ${TaskBridgeCommandName.ApproveAsk} ${command.taskId} -> approveAsk()`,
					command,
				)

				task.approveAsk(command.payload)
				break

			case TaskBridgeCommandName.DenyAsk:
				console.log(`[TaskChannel] ${TaskBridgeCommandName.DenyAsk} ${command.taskId} -> denyAsk()`, command)
				task.denyAsk(command.payload)
				break
		}
	}

	protected async handleConnect(socket: Socket): Promise<void> {
		// Rejoin all subscribed tasks.
		for (const taskId of this.subscribedTasks.keys()) {
			await this.publish(TaskSocketEvents.JOIN, { taskId })
		}

		// Subscribe to any pending tasks.
		for (const task of this.pendingTasks.values()) {
			await this.subscribeToTask(task, socket)
		}

		this.pendingTasks.clear()
	}

	protected async handleReconnect(_socket: Socket): Promise<void> {
		// Rejoin all subscribed tasks.
		for (const taskId of this.subscribedTasks.keys()) {
			await this.publish(TaskSocketEvents.JOIN, { taskId })
		}
	}

	protected async handleCleanup(socket: Socket): Promise<void> {
		const unsubscribePromises = []

		for (const taskId of this.subscribedTasks.keys()) {
			unsubscribePromises.push(this.unsubscribeFromTask(taskId, socket))
		}

		await Promise.allSettled(unsubscribePromises)
		this.subscribedTasks.clear()
		this.taskListeners.clear()
		this.pendingTasks.clear()
	}

	/**
	 * Add a task to the pending queue (will be subscribed when connected).
	 */
	public addPendingTask(task: TaskLike): void {
		this.pendingTasks.set(task.taskId, task)
	}

	public async subscribeToTask(task: TaskLike, _socket: Socket): Promise<void> {
		const taskId = task.taskId

		await this.publish(TaskSocketEvents.JOIN, { taskId }, (response: JoinResponse) => {
			if (response.success) {
				console.log(`[TaskChannel#subscribeToTask] subscribed to ${taskId}`)
				this.subscribedTasks.set(taskId, task)
				this.setupTaskListeners(task)
			} else {
				console.error(`[TaskChannel#subscribeToTask] failed to subscribe to ${taskId}: ${response.error}`)
			}
		})
	}

	public async unsubscribeFromTask(taskId: string, _socket: Socket): Promise<void> {
		const task = this.subscribedTasks.get(taskId)

		if (!task) {
			return
		}

		await this.publish(TaskSocketEvents.LEAVE, { taskId }, (response: LeaveResponse) => {
			if (response.success) {
				console.log(`[TaskChannel#unsubscribeFromTask] unsubscribed from ${taskId}`)
			} else {
				console.error(`[TaskChannel#unsubscribeFromTask] failed to unsubscribe from ${taskId}`)
			}

			// If we failed to unsubscribe then something is probably wrong and
			// we should still discard this task from `subscribedTasks`.
			this.removeTaskListeners(task)
			this.subscribedTasks.delete(taskId)
		})
	}

	private setupTaskListeners(task: TaskLike): void {
		if (this.taskListeners.has(task.taskId)) {
			console.warn(`[TaskChannel] Listeners already exist for task, removing old listeners for ${task.taskId}`)
			this.removeTaskListeners(task)
		}

		const listeners = new Map<TaskBridgeEventName, TaskEventListener>()

		this.eventMapping.forEach(({ from, to, createPayload }) => {
			const listener = (...args: unknown[]) => {
				const payload = createPayload(task, ...args)
				this.publish(TaskSocketEvents.EVENT, payload)
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			task.on(from, listener as any)
			listeners.set(to, listener)
		})

		this.taskListeners.set(task.taskId, listeners)
	}

	private removeTaskListeners(task: TaskLike): void {
		const listeners = this.taskListeners.get(task.taskId)

		if (!listeners) {
			return
		}

		this.eventMapping.forEach(({ from, to }) => {
			const listener = listeners.get(to)
			if (listener) {
				try {
					task.off(from, listener as any) // eslint-disable-line @typescript-eslint/no-explicit-any
				} catch (error) {
					console.error(
						`[TaskChannel] task.off(${from}) failed for task ${task.taskId}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
			}
		})

		this.taskListeners.delete(task.taskId)
	}
}
