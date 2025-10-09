import crypto from "crypto"
import os from "os"

import {
	type TaskProviderLike,
	type TaskLike,
	type CloudUserInfo,
	type ExtensionBridgeCommand,
	type TaskBridgeCommand,
	type StaticAppProperties,
	type GitProperties,
	ConnectionState,
	ExtensionSocketEvents,
	TaskSocketEvents,
} from "@roo-code/types"

import { SocketTransport } from "./SocketTransport.js"
import { ExtensionChannel } from "./ExtensionChannel.js"
import { TaskChannel } from "./TaskChannel.js"

export interface BridgeOrchestratorOptions {
	userId: string
	socketBridgeUrl: string
	token: string
	provider: TaskProviderLike
	sessionId: string
	isCloudAgent: boolean
}

/**
 * Central orchestrator for the extension bridge system.
 * Coordinates communication between the VSCode extension and web application
 * through WebSocket connections and manages extension/task channels.
 */
export class BridgeOrchestrator {
	private static instance: BridgeOrchestrator | null = null

	private static pendingTask: TaskLike | null = null

	// Core
	private readonly userId: string
	private readonly socketBridgeUrl: string
	private readonly token: string
	private readonly provider: TaskProviderLike
	private readonly instanceId: string
	private readonly appProperties: StaticAppProperties
	private readonly gitProperties?: GitProperties
	private readonly isCloudAgent?: boolean

	// Components
	private socketTransport: SocketTransport
	private extensionChannel: ExtensionChannel
	private taskChannel: TaskChannel

	// Reconnection
	private readonly MAX_RECONNECT_ATTEMPTS = Infinity
	private readonly RECONNECT_DELAY = 1_000
	private readonly RECONNECT_DELAY_MAX = 30_000

	public static getInstance(): BridgeOrchestrator | null {
		return BridgeOrchestrator.instance
	}

	public static isEnabled(user: CloudUserInfo | null, remoteControlEnabled: boolean): boolean {
		// Always disabled if signed out.
		if (!user) {
			return false
		}

		// Disabled by the user's organization?
		if (!user.extensionBridgeEnabled) {
			return false
		}

		// Disabled by the user?
		if (!remoteControlEnabled) {
			return false
		}

		return true
	}

	public static async connectOrDisconnect(
		userInfo: CloudUserInfo,
		remoteControlEnabled: boolean,
		options: BridgeOrchestratorOptions,
	): Promise<void> {
		if (BridgeOrchestrator.isEnabled(userInfo, remoteControlEnabled)) {
			await BridgeOrchestrator.connect(options)
		} else {
			await BridgeOrchestrator.disconnect()
		}
	}

	public static async connect(options: BridgeOrchestratorOptions) {
		const instance = BridgeOrchestrator.instance

		if (!instance) {
			try {
				console.log(`[BridgeOrchestrator#connectOrDisconnect] Connecting...`)

				// Populate telemetry properties before registering the instance.
				await options.provider.getTelemetryProperties()

				BridgeOrchestrator.instance = new BridgeOrchestrator(options)
				await BridgeOrchestrator.instance.connect()
			} catch (error) {
				console.error(
					`[BridgeOrchestrator#connectOrDisconnect] connect() failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		} else {
			if (
				instance.connectionState === ConnectionState.FAILED ||
				instance.connectionState === ConnectionState.DISCONNECTED
			) {
				console.log(
					`[BridgeOrchestrator#connectOrDisconnect] Re-connecting... (state: ${instance.connectionState})`,
				)

				instance.reconnect().catch((error) => {
					console.error(
						`[BridgeOrchestrator#connectOrDisconnect] reconnect() failed: ${error instanceof Error ? error.message : String(error)}`,
					)
				})
			} else {
				console.log(
					`[BridgeOrchestrator#connectOrDisconnect] Already connected or connecting (state: ${instance.connectionState})`,
				)
			}
		}
	}

	public static async disconnect() {
		const instance = BridgeOrchestrator.instance

		if (instance) {
			try {
				console.log(
					`[BridgeOrchestrator#connectOrDisconnect] Disconnecting... (state: ${instance.connectionState})`,
				)

				await instance.disconnect()
			} catch (error) {
				console.error(
					`[BridgeOrchestrator#connectOrDisconnect] disconnect() failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			} finally {
				BridgeOrchestrator.instance = null
			}
		} else {
			console.log(`[BridgeOrchestrator#connectOrDisconnect] Already disconnected`)
		}
	}

	/**
	 * @TODO: What if subtasks also get spawned? We'd probably want deferred
	 * subscriptions for those too.
	 */
	public static async subscribeToTask(task: TaskLike): Promise<void> {
		const instance = BridgeOrchestrator.instance

		if (instance && instance.socketTransport.isConnected()) {
			console.log(`[BridgeOrchestrator#subscribeToTask] Subscribing to task ${task.taskId}`)
			await instance.subscribeToTask(task)
		} else {
			console.log(`[BridgeOrchestrator#subscribeToTask] Deferring subscription for task ${task.taskId}`)
			BridgeOrchestrator.pendingTask = task
		}
	}

	private constructor(options: BridgeOrchestratorOptions) {
		this.userId = options.userId
		this.socketBridgeUrl = options.socketBridgeUrl
		this.token = options.token
		this.provider = options.provider
		this.instanceId = options.sessionId || crypto.randomUUID()
		this.appProperties = { ...options.provider.appProperties, hostname: os.hostname() }
		this.gitProperties = options.provider.gitProperties
		this.isCloudAgent = options.isCloudAgent

		this.socketTransport = new SocketTransport({
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

		this.extensionChannel = new ExtensionChannel({
			instanceId: this.instanceId,
			appProperties: this.appProperties,
			gitProperties: this.gitProperties,
			userId: this.userId,
			provider: this.provider,
			isCloudAgent: this.isCloudAgent,
		})

		this.taskChannel = new TaskChannel({
			instanceId: this.instanceId,
			appProperties: this.appProperties,
			gitProperties: this.gitProperties,
			isCloudAgent: this.isCloudAgent,
		})
	}

	private setupSocketListeners() {
		const socket = this.socketTransport.getSocket()

		if (!socket) {
			console.error("[BridgeOrchestrator] Socket not available")
			return
		}

		// Remove any existing listeners first to prevent duplicates.
		socket.off(ExtensionSocketEvents.RELAYED_COMMAND)
		socket.off(TaskSocketEvents.RELAYED_COMMAND)
		socket.off("connected")

		socket.on(ExtensionSocketEvents.RELAYED_COMMAND, (message: ExtensionBridgeCommand) => {
			console.log(
				`[BridgeOrchestrator] on(${ExtensionSocketEvents.RELAYED_COMMAND}) -> ${message.type} for ${message.instanceId}`,
			)

			this.extensionChannel?.handleCommand(message)
		})

		socket.on(TaskSocketEvents.RELAYED_COMMAND, (message: TaskBridgeCommand) => {
			console.log(
				`[BridgeOrchestrator] on(${TaskSocketEvents.RELAYED_COMMAND}) -> ${message.type} for ${message.taskId}`,
			)

			this.taskChannel.handleCommand(message)
		})
	}

	private async handleConnect() {
		const socket = this.socketTransport.getSocket()

		if (!socket) {
			console.error("[BridgeOrchestrator#handleConnect] Socket not available")
			return
		}

		await this.extensionChannel.onConnect(socket)
		await this.taskChannel.onConnect(socket)

		if (BridgeOrchestrator.pendingTask) {
			console.log(
				`[BridgeOrchestrator#handleConnect] Subscribing to task ${BridgeOrchestrator.pendingTask.taskId}`,
			)

			try {
				await this.subscribeToTask(BridgeOrchestrator.pendingTask)
				BridgeOrchestrator.pendingTask = null
			} catch (error) {
				console.error(
					`[BridgeOrchestrator#handleConnect] subscribeToTask() failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
	}

	private handleDisconnect() {
		this.extensionChannel.onDisconnect()
		this.taskChannel.onDisconnect()
	}

	private async handleReconnect() {
		const socket = this.socketTransport.getSocket()

		if (!socket) {
			console.error("[BridgeOrchestrator] Socket not available after reconnect")
			return
		}

		// Re-setup socket listeners to ensure they're properly configured
		// after automatic reconnection (Socket.IO's built-in reconnection)
		// The socket.off() calls in setupSocketListeners prevent duplicates
		this.setupSocketListeners()

		await this.extensionChannel.onReconnect(socket)
		await this.taskChannel.onReconnect(socket)
	}

	// Task API

	public async subscribeToTask(task: TaskLike): Promise<void> {
		const socket = this.socketTransport.getSocket()

		if (!socket || !this.socketTransport.isConnected()) {
			console.warn("[BridgeOrchestrator] Cannot subscribe to task: not connected. Will retry when connected.")
			this.taskChannel.addPendingTask(task)

			if (
				this.connectionState === ConnectionState.DISCONNECTED ||
				this.connectionState === ConnectionState.FAILED
			) {
				await this.connect()
			}

			return
		}

		await this.taskChannel.subscribeToTask(task, socket)
	}

	public async unsubscribeFromTask(taskId: string): Promise<void> {
		const socket = this.socketTransport.getSocket()

		if (!socket) {
			return
		}

		await this.taskChannel.unsubscribeFromTask(taskId, socket)
	}

	// Shared API

	public get connectionState(): ConnectionState {
		return this.socketTransport.getConnectionState()
	}

	private async connect(): Promise<void> {
		await this.socketTransport.connect()
		this.setupSocketListeners()
	}

	public async disconnect(): Promise<void> {
		await this.extensionChannel.cleanup(this.socketTransport.getSocket())
		await this.taskChannel.cleanup(this.socketTransport.getSocket())
		await this.socketTransport.disconnect()
		BridgeOrchestrator.instance = null
		BridgeOrchestrator.pendingTask = null
	}

	public async reconnect(): Promise<void> {
		await this.socketTransport.reconnect()

		// After a manual reconnect, we have a new socket instance
		// so we need to set up listeners again.
		this.setupSocketListeners()
	}
}
