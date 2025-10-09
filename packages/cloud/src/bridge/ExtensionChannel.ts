import type { Socket } from "socket.io-client"

import {
	type TaskProviderLike,
	type TaskProviderEvents,
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

import { type BaseChannelOptions, BaseChannel } from "./BaseChannel.js"

interface ExtensionChannelOptions extends BaseChannelOptions {
	userId: string
	provider: TaskProviderLike
}

/**
 * Manages the extension-level communication channel.
 * Handles extension registration, heartbeat, and extension-specific commands.
 */
export class ExtensionChannel extends BaseChannel<
	ExtensionBridgeCommand,
	ExtensionSocketEvents,
	ExtensionBridgeEvent | ExtensionInstance
> {
	private userId: string
	private provider: TaskProviderLike
	private extensionInstance: ExtensionInstance
	private heartbeatInterval: NodeJS.Timeout | null = null
	private eventListeners: Map<RooCodeEventName, (...args: unknown[]) => void> = new Map()

	constructor(options: ExtensionChannelOptions) {
		super({
			instanceId: options.instanceId,
			appProperties: options.appProperties,
			gitProperties: options.gitProperties,
			isCloudAgent: options.isCloudAgent,
		})

		this.userId = options.userId
		this.provider = options.provider

		this.extensionInstance = {
			instanceId: this.instanceId,
			userId: this.userId,
			workspacePath: this.provider.cwd,
			appProperties: this.appProperties,
			gitProperties: this.gitProperties,
			lastHeartbeat: Date.now(),
			task: { taskId: "", taskStatus: TaskStatus.None },
			taskHistory: [],
			isCloudAgent: this.isCloudAgent,
		}

		this.setupListeners()
	}

	protected async handleCommandImplementation(command: ExtensionBridgeCommand): Promise<void> {
		if (command.instanceId !== this.instanceId) {
			console.log(`[ExtensionChannel] command -> instance id mismatch | ${this.instanceId}`, {
				messageInstanceId: command.instanceId,
			})

			return
		}

		switch (command.type) {
			case ExtensionBridgeCommandName.StartTask: {
				console.log(`[ExtensionChannel] command -> createTask() | ${command.instanceId}`, {
					text: command.payload.text?.substring(0, 100) + "...",
					hasImages: !!command.payload.images,
					mode: command.payload.mode,
					providerProfile: command.payload.providerProfile,
				})

				this.provider.createTask(
					command.payload.text,
					command.payload.images,
					undefined, // parentTask
					undefined, // options
					{ mode: command.payload.mode, currentApiConfigName: command.payload.providerProfile },
				)

				break
			}
			case ExtensionBridgeCommandName.StopTask: {
				const instance = await this.updateInstance()

				if (instance.task.taskStatus === TaskStatus.Running) {
					console.log(`[ExtensionChannel] command -> cancelTask() | ${command.instanceId}`)
					this.provider.cancelTask()
					this.provider.postStateToWebview()
				} else if (instance.task.taskId) {
					console.log(`[ExtensionChannel] command -> clearTask() | ${command.instanceId}`)
					this.provider.clearTask()
					this.provider.postStateToWebview()
				}

				break
			}
			case ExtensionBridgeCommandName.ResumeTask: {
				console.log(`[ExtensionChannel] command -> resumeTask() | ${command.instanceId}`, {
					taskId: command.payload.taskId,
				})

				this.provider.resumeTask(command.payload.taskId)
				this.provider.postStateToWebview()
				break
			}
		}
	}

	protected async handleConnect(socket: Socket): Promise<void> {
		await this.registerInstance(socket)
		this.startHeartbeat(socket)
	}

	protected async handleReconnect(socket: Socket): Promise<void> {
		await this.registerInstance(socket)
		this.startHeartbeat(socket)
	}

	protected override handleDisconnect(): void {
		this.stopHeartbeat()
	}

	protected async handleCleanup(socket: Socket): Promise<void> {
		this.stopHeartbeat()
		this.cleanupListeners()
		await this.unregisterInstance(socket)
	}

	private async registerInstance(_socket: Socket): Promise<void> {
		const instance = await this.updateInstance()
		await this.publish(ExtensionSocketEvents.REGISTER, instance)
	}

	private async unregisterInstance(_socket: Socket): Promise<void> {
		const instance = await this.updateInstance()
		await this.publish(ExtensionSocketEvents.UNREGISTER, instance)
	}

	private startHeartbeat(socket: Socket): void {
		this.stopHeartbeat()

		this.heartbeatInterval = setInterval(async () => {
			const instance = await this.updateInstance()

			try {
				socket.emit(ExtensionSocketEvents.HEARTBEAT, instance)
				// Heartbeat is too frequent to log
			} catch (error) {
				console.error(
					`[ExtensionChannel] emit() failed -> ${ExtensionSocketEvents.HEARTBEAT}: ${
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
			{ from: RooCodeEventName.TaskCreated, to: ExtensionBridgeEventName.TaskCreated },
			{ from: RooCodeEventName.TaskStarted, to: ExtensionBridgeEventName.TaskStarted },
			{ from: RooCodeEventName.TaskCompleted, to: ExtensionBridgeEventName.TaskCompleted },
			{ from: RooCodeEventName.TaskAborted, to: ExtensionBridgeEventName.TaskAborted },
			{ from: RooCodeEventName.TaskFocused, to: ExtensionBridgeEventName.TaskFocused },
			{ from: RooCodeEventName.TaskUnfocused, to: ExtensionBridgeEventName.TaskUnfocused },
			{ from: RooCodeEventName.TaskActive, to: ExtensionBridgeEventName.TaskActive },
			{ from: RooCodeEventName.TaskInteractive, to: ExtensionBridgeEventName.TaskInteractive },
			{ from: RooCodeEventName.TaskResumable, to: ExtensionBridgeEventName.TaskResumable },
			{ from: RooCodeEventName.TaskIdle, to: ExtensionBridgeEventName.TaskIdle },
			{ from: RooCodeEventName.TaskPaused, to: ExtensionBridgeEventName.TaskPaused },
			{ from: RooCodeEventName.TaskUnpaused, to: ExtensionBridgeEventName.TaskUnpaused },
			{ from: RooCodeEventName.TaskSpawned, to: ExtensionBridgeEventName.TaskSpawned },
			{ from: RooCodeEventName.TaskUserMessage, to: ExtensionBridgeEventName.TaskUserMessage },
			{ from: RooCodeEventName.TaskTokenUsageUpdated, to: ExtensionBridgeEventName.TaskTokenUsageUpdated },
		] as const

		eventMapping.forEach(({ from, to }) => {
			// Create and store the listener function for cleanup.
			const listener = async (..._args: unknown[]) => {
				this.publish(ExtensionSocketEvents.EVENT, {
					type: to,
					instance: await this.updateInstance(),
					timestamp: Date.now(),
				})
			}

			this.eventListeners.set(from, listener)
			this.provider.on(from, listener)
		})
	}

	private cleanupListeners(): void {
		this.eventListeners.forEach((listener, eventName) => {
			// Cast is safe because we only store valid event names from eventMapping.
			this.provider.off(eventName as keyof TaskProviderEvents, listener)
		})

		this.eventListeners.clear()
	}

	private async updateInstance(): Promise<ExtensionInstance> {
		const task = this.provider?.getCurrentTask()
		const taskHistory = this.provider?.getRecentTasks() ?? []

		const mode = await this.provider?.getMode()
		const modes = (await this.provider?.getModes()) ?? []

		const providerProfile = await this.provider?.getProviderProfile()
		const providerProfiles = (await this.provider?.getProviderProfiles()) ?? []

		this.extensionInstance = {
			...this.extensionInstance,
			lastHeartbeat: Date.now(),
			task: task
				? {
						taskId: task.taskId,
						parentTaskId: task.parentTaskId,
						childTaskId: task.childTaskId,
						taskStatus: task.taskStatus,
						taskAsk: task?.taskAsk,
						queuedMessages: task.queuedMessages,
						tokenUsage: task.tokenUsage,
						...task.metadata,
					}
				: { taskId: "", taskStatus: TaskStatus.None },
			taskAsk: task?.taskAsk,
			taskHistory,
			mode,
			providerProfile,
			modes,
			providerProfiles,
		}

		return this.extensionInstance
	}
}
