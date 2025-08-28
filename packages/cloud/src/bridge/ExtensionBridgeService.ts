import crypto from "crypto"

import {
	type TaskProviderLike,
	type TaskLike,
	type CloudUserInfo,
	type ExtensionBridgeCommand,
	type TaskBridgeCommand,
	ConnectionState,
	ExtensionSocketEvents,
	TaskSocketEvents,
} from "@roo-code/types"

import { SocketConnectionManager } from "./SocketConnectionManager.js"
import { ExtensionManager } from "./ExtensionManager.js"
import { TaskManager } from "./TaskManager.js"

export interface ExtensionBridgeServiceOptions {
	userId: string
	socketBridgeUrl: string
	token: string
	provider: TaskProviderLike
	sessionId?: string
}

export class ExtensionBridgeService {
	private static instance: ExtensionBridgeService | null = null

	// Core
	private readonly userId: string
	private readonly socketBridgeUrl: string
	private readonly token: string
	private readonly provider: TaskProviderLike
	private readonly instanceId: string

	// Managers
	private connectionManager: SocketConnectionManager
	private extensionManager: ExtensionManager
	private taskManager: TaskManager

	// Reconnection
	private readonly MAX_RECONNECT_ATTEMPTS = Infinity
	private readonly RECONNECT_DELAY = 1_000
	private readonly RECONNECT_DELAY_MAX = 30_000

	public static getInstance(): ExtensionBridgeService | null {
		return ExtensionBridgeService.instance
	}

	public static async createInstance(options: ExtensionBridgeServiceOptions) {
		console.log("[ExtensionBridgeService] createInstance")
		ExtensionBridgeService.instance = new ExtensionBridgeService(options)
		await ExtensionBridgeService.instance.initialize()
		return ExtensionBridgeService.instance
	}

	public static resetInstance() {
		if (ExtensionBridgeService.instance) {
			console.log("[ExtensionBridgeService] resetInstance")
			ExtensionBridgeService.instance.disconnect().catch(() => {})
			ExtensionBridgeService.instance = null
		}
	}

	public static async handleRemoteControlState(
		userInfo: CloudUserInfo | null,
		remoteControlEnabled: boolean | undefined,
		options: ExtensionBridgeServiceOptions,
		logger?: (message: string) => void,
	) {
		if (userInfo?.extensionBridgeEnabled && remoteControlEnabled) {
			const existingService = ExtensionBridgeService.getInstance()

			if (!existingService) {
				try {
					const service = await ExtensionBridgeService.createInstance(options)
					const state = service.getConnectionState()

					logger?.(`[ExtensionBridgeService#handleRemoteControlState] Instance created (state: ${state})`)

					if (state !== ConnectionState.CONNECTED) {
						logger?.(
							`[ExtensionBridgeService#handleRemoteControlState] Service is not connected yet, will retry in background`,
						)
					}
				} catch (error) {
					const message = `[ExtensionBridgeService#handleRemoteControlState] Failed to create instance: ${
						error instanceof Error ? error.message : String(error)
					}`

					logger?.(message)
					console.error(message)
				}
			} else {
				const state = existingService.getConnectionState()

				if (state === ConnectionState.FAILED || state === ConnectionState.DISCONNECTED) {
					logger?.(
						`[ExtensionBridgeService#handleRemoteControlState] Existing service is ${state}, attempting reconnection`,
					)

					existingService.reconnect().catch((error) => {
						const message = `[ExtensionBridgeService#handleRemoteControlState] Reconnection failed: ${
							error instanceof Error ? error.message : String(error)
						}`

						logger?.(message)
						console.error(message)
					})
				}
			}
		} else {
			const existingService = ExtensionBridgeService.getInstance()

			if (existingService) {
				try {
					await existingService.disconnect()
					ExtensionBridgeService.resetInstance()

					logger?.(`[ExtensionBridgeService#handleRemoteControlState] Service disconnected and reset`)
				} catch (error) {
					const message = `[ExtensionBridgeService#handleRemoteControlState] Failed to disconnect and reset instance: ${
						error instanceof Error ? error.message : String(error)
					}`

					logger?.(message)
					console.error(message)
				}
			}
		}
	}

	private constructor(options: ExtensionBridgeServiceOptions) {
		this.userId = options.userId
		this.socketBridgeUrl = options.socketBridgeUrl
		this.token = options.token
		this.provider = options.provider
		this.instanceId = options.sessionId || crypto.randomUUID()

		this.connectionManager = new SocketConnectionManager({
			url: this.socketBridgeUrl,
			socketOptions: {
				query: {
					token: this.token,
					clientType: "extension",
					instanceId: this.instanceId,
				},
				transports: ["websocket", "polling"],
				reconnection: true,
				reconnectionAttempts: this.MAX_RECONNECT_ATTEMPTS,
				reconnectionDelay: this.RECONNECT_DELAY,
				reconnectionDelayMax: this.RECONNECT_DELAY_MAX,
			},
			onConnect: () => this.handleConnect(),
			onDisconnect: () => this.handleDisconnect(),
			onReconnect: () => this.handleReconnect(),
		})

		this.extensionManager = new ExtensionManager(this.instanceId, this.userId, this.provider)

		this.taskManager = new TaskManager()
	}

	private async initialize() {
		// Populate the app and git properties before registering the instance.
		await this.provider.getTelemetryProperties()

		await this.connectionManager.connect()
		this.setupSocketListeners()
	}

	private setupSocketListeners() {
		const socket = this.connectionManager.getSocket()

		if (!socket) {
			console.error("[ExtensionBridgeService] Socket not available")
			return
		}

		// Remove any existing listeners first to prevent duplicates.
		socket.off(ExtensionSocketEvents.RELAYED_COMMAND)
		socket.off(TaskSocketEvents.RELAYED_COMMAND)
		socket.off("connected")

		socket.on(ExtensionSocketEvents.RELAYED_COMMAND, (message: ExtensionBridgeCommand) => {
			console.log(
				`[ExtensionBridgeService] on(${ExtensionSocketEvents.RELAYED_COMMAND}) -> ${message.type} for ${message.instanceId}`,
			)

			this.extensionManager?.handleExtensionCommand(message)
		})

		socket.on(TaskSocketEvents.RELAYED_COMMAND, (message: TaskBridgeCommand) => {
			console.log(
				`[ExtensionBridgeService] on(${TaskSocketEvents.RELAYED_COMMAND}) -> ${message.type} for ${message.taskId}`,
			)

			this.taskManager.handleTaskCommand(message)
		})
	}

	private async handleConnect() {
		const socket = this.connectionManager.getSocket()

		if (!socket) {
			console.error("[ExtensionBridgeService] Socket not available after connect")

			return
		}

		await this.extensionManager.onConnect(socket)
		await this.taskManager.onConnect(socket)
	}

	private handleDisconnect() {
		this.extensionManager.onDisconnect()
		this.taskManager.onDisconnect()
	}

	private async handleReconnect() {
		const socket = this.connectionManager.getSocket()

		if (!socket) {
			console.error("[ExtensionBridgeService] Socket not available after reconnect")

			return
		}

		// Re-setup socket listeners to ensure they're properly configured
		// after automatic reconnection (Socket.IO's built-in reconnection)
		// The socket.off() calls in setupSocketListeners prevent duplicates
		this.setupSocketListeners()

		await this.extensionManager.onReconnect(socket)
		await this.taskManager.onReconnect(socket)
	}

	// Task API

	public async subscribeToTask(task: TaskLike): Promise<void> {
		const socket = this.connectionManager.getSocket()

		if (!socket || !this.connectionManager.isConnected()) {
			console.warn("[ExtensionBridgeService] Cannot subscribe to task: not connected. Will retry when connected.")

			this.taskManager.addPendingTask(task)

			const state = this.connectionManager.getConnectionState()

			if (state === ConnectionState.DISCONNECTED || state === ConnectionState.FAILED) {
				this.initialize()
			}

			return
		}

		await this.taskManager.subscribeToTask(task, socket)
	}

	public async unsubscribeFromTask(taskId: string): Promise<void> {
		const socket = this.connectionManager.getSocket()

		if (!socket) {
			return
		}

		await this.taskManager.unsubscribeFromTask(taskId, socket)
	}

	// Shared API

	public getConnectionState(): ConnectionState {
		return this.connectionManager.getConnectionState()
	}

	public async disconnect(): Promise<void> {
		await this.extensionManager.cleanup(this.connectionManager.getSocket())
		await this.taskManager.cleanup(this.connectionManager.getSocket())
		await this.connectionManager.disconnect()
		ExtensionBridgeService.instance = null
	}

	public async reconnect(): Promise<void> {
		await this.connectionManager.reconnect()

		// After a manual reconnect, we have a new socket instance
		// so we need to set up listeners again.
		this.setupSocketListeners()
	}
}
