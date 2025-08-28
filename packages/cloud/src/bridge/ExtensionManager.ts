import type { Socket } from "socket.io-client"

import {
	type TaskProviderLike,
	type ExtensionInstance,
	type ExtensionBridgeCommand,
	type ExtensionBridgeEvent,
	RooCodeEventName,
	TaskStatus,
	ExtensionBridgeCommandName,
	ExtensionBridgeEventName,
	ExtensionSocketEvents,
	HEARTBEAT_INTERVAL_MS,
} from "@roo-code/types"

export class ExtensionManager {
	private instanceId: string
	private userId: string
	private provider: TaskProviderLike
	private extensionInstance: ExtensionInstance
	private heartbeatInterval: NodeJS.Timeout | null = null
	private socket: Socket | null = null

	constructor(instanceId: string, userId: string, provider: TaskProviderLike) {
		this.instanceId = instanceId
		this.userId = userId
		this.provider = provider

		this.extensionInstance = {
			instanceId: this.instanceId,
			userId: this.userId,
			workspacePath: this.provider.cwd,
			appProperties: this.provider.appProperties,
			gitProperties: this.provider.gitProperties,
			lastHeartbeat: Date.now(),
			task: {
				taskId: "",
				taskStatus: TaskStatus.None,
			},
			taskHistory: [],
		}

		this.setupListeners()
	}

	public async onConnect(socket: Socket): Promise<void> {
		this.socket = socket
		await this.registerInstance(socket)
		this.startHeartbeat(socket)
	}

	public onDisconnect(): void {
		this.stopHeartbeat()
		this.socket = null
	}

	public async onReconnect(socket: Socket): Promise<void> {
		this.socket = socket
		await this.registerInstance(socket)
		this.startHeartbeat(socket)
	}

	public async cleanup(socket: Socket | null): Promise<void> {
		this.stopHeartbeat()

		if (socket) {
			await this.unregisterInstance(socket)
		}

		this.socket = null
	}

	public handleExtensionCommand(message: ExtensionBridgeCommand): void {
		if (message.instanceId !== this.instanceId) {
			console.log(`[ExtensionManager] command -> instance id mismatch | ${this.instanceId}`, {
				messageInstanceId: message.instanceId,
			})

			return
		}

		switch (message.type) {
			case ExtensionBridgeCommandName.StartTask: {
				console.log(`[ExtensionManager] command -> createTask() | ${message.instanceId}`, {
					text: message.payload.text?.substring(0, 100) + "...",
					hasImages: !!message.payload.images,
				})

				this.provider.createTask(message.payload.text, message.payload.images)

				break
			}
			case ExtensionBridgeCommandName.StopTask: {
				const instance = this.updateInstance()

				if (instance.task.taskStatus === TaskStatus.Running) {
					console.log(`[ExtensionManager] command -> cancelTask() | ${message.instanceId}`)

					this.provider.cancelTask()
					this.provider.postStateToWebview()
				} else if (instance.task.taskId) {
					console.log(`[ExtensionManager] command -> clearTask() | ${message.instanceId}`)

					this.provider.clearTask()
					this.provider.postStateToWebview()
				}

				break
			}
			case ExtensionBridgeCommandName.ResumeTask: {
				console.log(`[ExtensionManager] command -> resumeTask() | ${message.instanceId}`, {
					taskId: message.payload.taskId,
				})

				// Resume the task from history by taskId
				this.provider.resumeTask(message.payload.taskId)

				this.provider.postStateToWebview()

				break
			}
		}
	}

	private async registerInstance(socket: Socket): Promise<void> {
		const instance = this.updateInstance()

		try {
			socket.emit(ExtensionSocketEvents.REGISTER, instance)

			console.log(
				`[ExtensionManager] emit() -> ${ExtensionSocketEvents.REGISTER}`,
				// instance,
			)
		} catch (error) {
			console.error(
				`[ExtensionManager] emit() failed -> ${ExtensionSocketEvents.REGISTER}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)

			return
		}
	}

	private async unregisterInstance(socket: Socket): Promise<void> {
		const instance = this.updateInstance()

		try {
			socket.emit(ExtensionSocketEvents.UNREGISTER, instance)

			console.log(
				`[ExtensionManager] emit() -> ${ExtensionSocketEvents.UNREGISTER}`,
				// instance,
			)
		} catch (error) {
			console.error(
				`[ExtensionManager] emit() failed -> ${ExtensionSocketEvents.UNREGISTER}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	private startHeartbeat(socket: Socket): void {
		this.stopHeartbeat()

		this.heartbeatInterval = setInterval(async () => {
			const instance = this.updateInstance()

			try {
				socket.emit(ExtensionSocketEvents.HEARTBEAT, instance)

				// console.log(
				//   `[ExtensionManager] emit() -> ${ExtensionSocketEvents.HEARTBEAT}`,
				//   instance,
				// );
			} catch (error) {
				console.error(
					`[ExtensionManager] emit() failed -> ${ExtensionSocketEvents.HEARTBEAT}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}, HEARTBEAT_INTERVAL_MS)
	}

	private stopHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval)
			this.heartbeatInterval = null
		}
	}

	private setupListeners(): void {
		const eventMapping = [
			{
				from: RooCodeEventName.TaskCreated,
				to: ExtensionBridgeEventName.TaskCreated,
			},
			{
				from: RooCodeEventName.TaskStarted,
				to: ExtensionBridgeEventName.TaskStarted,
			},
			{
				from: RooCodeEventName.TaskCompleted,
				to: ExtensionBridgeEventName.TaskCompleted,
			},
			{
				from: RooCodeEventName.TaskAborted,
				to: ExtensionBridgeEventName.TaskAborted,
			},
			{
				from: RooCodeEventName.TaskFocused,
				to: ExtensionBridgeEventName.TaskFocused,
			},
			{
				from: RooCodeEventName.TaskUnfocused,
				to: ExtensionBridgeEventName.TaskUnfocused,
			},
			{
				from: RooCodeEventName.TaskActive,
				to: ExtensionBridgeEventName.TaskActive,
			},
			{
				from: RooCodeEventName.TaskInteractive,
				to: ExtensionBridgeEventName.TaskInteractive,
			},
			{
				from: RooCodeEventName.TaskResumable,
				to: ExtensionBridgeEventName.TaskResumable,
			},
			{
				from: RooCodeEventName.TaskIdle,
				to: ExtensionBridgeEventName.TaskIdle,
			},
		] as const

		const addListener =
			(type: ExtensionBridgeEventName) =>
			async (..._args: unknown[]) => {
				this.publishEvent({
					type,
					instance: this.updateInstance(),
					timestamp: Date.now(),
				})
			}

		eventMapping.forEach(({ from, to }) => this.provider.on(from, addListener(to)))
	}

	private async publishEvent(message: ExtensionBridgeEvent): Promise<boolean> {
		if (!this.socket) {
			console.error("[ExtensionManager] publishEvent -> socket not available")
			return false
		}

		try {
			this.socket.emit(ExtensionSocketEvents.EVENT, message)

			console.log(`[ExtensionManager] emit() -> ${ExtensionSocketEvents.EVENT} ${message.type}`, message)

			return true
		} catch (error) {
			console.error(
				`[ExtensionManager] emit() failed -> ${ExtensionSocketEvents.EVENT}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)

			return false
		}
	}

	private updateInstance(): ExtensionInstance {
		const task = this.provider?.getCurrentTask()
		const taskHistory = this.provider?.getRecentTasks() ?? []

		this.extensionInstance = {
			...this.extensionInstance,
			appProperties: this.extensionInstance.appProperties ?? this.provider.appProperties,
			gitProperties: this.extensionInstance.gitProperties ?? this.provider.gitProperties,
			lastHeartbeat: Date.now(),
			task: task
				? {
						taskId: task.taskId,
						taskStatus: task.taskStatus,
						...task.metadata,
					}
				: { taskId: "", taskStatus: TaskStatus.None },
			taskAsk: task?.taskAsk,
			taskHistory,
		}

		return this.extensionInstance
	}
}
