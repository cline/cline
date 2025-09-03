import { io, type Socket, type SocketOptions, type ManagerOptions } from "socket.io-client"

import { ConnectionState, type RetryConfig } from "@roo-code/types"

export interface SocketTransportOptions {
	url: string
	socketOptions: Partial<ManagerOptions & SocketOptions>
	onConnect?: () => void | Promise<void>
	onDisconnect?: (reason: string) => void
	onReconnect?: (attemptNumber: number) => void | Promise<void>
	logger?: {
		log: (message: string, ...args: unknown[]) => void
		error: (message: string, ...args: unknown[]) => void
		warn: (message: string, ...args: unknown[]) => void
	}
}

/**
 * Manages the WebSocket transport layer for the bridge system.
 * Handles connection lifecycle, retries, and reconnection logic.
 */
export class SocketTransport {
	private socket: Socket | null = null
	private connectionState: ConnectionState = ConnectionState.DISCONNECTED
	private retryTimeout: NodeJS.Timeout | null = null
	private hasConnectedOnce: boolean = false

	private readonly retryConfig: RetryConfig = {
		maxInitialAttempts: Infinity,
		initialDelay: 1_000,
		maxDelay: 15_000,
		backoffMultiplier: 2,
	}

	private readonly CONNECTION_TIMEOUT = 2_000
	private readonly options: SocketTransportOptions

	constructor(options: SocketTransportOptions, retryConfig?: Partial<RetryConfig>) {
		this.options = options

		if (retryConfig) {
			this.retryConfig = { ...this.retryConfig, ...retryConfig }
		}
	}

	// This is the initial connnect attempt. We need to implement our own
	// infinite retry mechanism since Socket.io's automatic reconnection only
	// kicks in after a successful initial connection.
	public async connect(): Promise<void> {
		if (this.connectionState === ConnectionState.CONNECTED) {
			console.log(`[SocketTransport] Already connected`)
			return
		}

		if (this.connectionState === ConnectionState.CONNECTING || this.connectionState === ConnectionState.RETRYING) {
			console.log(`[SocketTransport] Connection attempt already in progress`)
			return
		}

		let attempt = 0
		let delay = this.retryConfig.initialDelay

		while (attempt < this.retryConfig.maxInitialAttempts) {
			console.log(`[SocketTransport] Initial connect attempt ${attempt + 1}`)
			this.connectionState = attempt === 0 ? ConnectionState.CONNECTING : ConnectionState.RETRYING

			try {
				await this._connect()
				console.log(`[SocketTransport] Connected to ${this.options.url}`)
				this.connectionState = ConnectionState.CONNECTED

				if (this.options.onConnect) {
					await this.options.onConnect()
				}

				break
			} catch (_error) {
				attempt++

				if (this.socket) {
					this.socket.disconnect()
					this.socket = null
				}

				console.log(`[SocketTransport] Waiting ${delay}ms before retry...`)

				const promise = new Promise((resolve) => {
					this.retryTimeout = setTimeout(resolve, delay)
				})

				await promise

				delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelay)
			}
		}

		if (this.retryTimeout) {
			clearTimeout(this.retryTimeout)
			this.retryTimeout = null
		}

		if (this.connectionState === ConnectionState.CONNECTED) {
			console.log(`[SocketTransport] Connected to ${this.options.url}`)
		} else {
			this.connectionState = ConnectionState.FAILED
			console.error(`[SocketTransport] Failed to connect to ${this.options.url}, giving up`)
		}
	}

	private async _connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.socket = io(this.options.url, this.options.socketOptions)

			let connectionTimeout: NodeJS.Timeout | null = setTimeout(() => {
				console.error(`[SocketTransport] failed to connect after ${this.CONNECTION_TIMEOUT}ms`)

				if (this.connectionState !== ConnectionState.CONNECTED) {
					this.socket?.disconnect()
					reject(new Error("Connection timeout"))
				}
			}, this.CONNECTION_TIMEOUT)

			// https://socket.io/docs/v4/client-api/#event-connect
			this.socket.on("connect", async () => {
				console.log(`[SocketTransport] on(connect)`)

				if (connectionTimeout) {
					clearTimeout(connectionTimeout)
					connectionTimeout = null
				}

				if (this.hasConnectedOnce) {
					this.connectionState = ConnectionState.CONNECTED

					if (this.options.onReconnect) {
						await this.options.onReconnect(0)
					}
				}

				this.hasConnectedOnce = true
				resolve()
			})

			// https://socket.io/docs/v4/client-api/#event-connect_error
			this.socket.on("connect_error", (error) => {
				if (connectionTimeout && this.connectionState !== ConnectionState.CONNECTED) {
					console.error(`[SocketTransport] on(connect_error): ${error.message}`)
					clearTimeout(connectionTimeout)
					connectionTimeout = null
					reject(error)
				}
			})

			// https://socket.io/docs/v4/client-api/#event-disconnect
			this.socket.on("disconnect", (reason, details) => {
				console.log(`[SocketTransport] on(disconnect) (reason: ${reason}, details: ${JSON.stringify(details)})`)
				this.connectionState = ConnectionState.DISCONNECTED

				if (this.options.onDisconnect) {
					this.options.onDisconnect(reason)
				}

				// Don't attempt to reconnect if we're manually disconnecting.
				const isManualDisconnect = reason === "io client disconnect"

				if (!isManualDisconnect && this.hasConnectedOnce) {
					// After successful initial connection, rely entirely on
					// Socket.IO's reconnection logic.
					console.log("[SocketTransport] will attempt to reconnect")
				} else {
					console.log("[SocketTransport] will *NOT* attempt to reconnect")
				}
			})

			// https://socket.io/docs/v4/client-api/#event-error
			// Fired upon a connection error.
			this.socket.io.on("error", (error) => {
				// Connection error.
				if (connectionTimeout && this.connectionState !== ConnectionState.CONNECTED) {
					console.error(`[SocketTransport] on(error): ${error.message}`)
					clearTimeout(connectionTimeout)
					connectionTimeout = null
					reject(error)
				}

				// Post-connection error.
				if (this.connectionState === ConnectionState.CONNECTED) {
					console.error(`[SocketTransport] on(error): ${error.message}`)
				}
			})

			// https://socket.io/docs/v4/client-api/#event-reconnect
			// Fired upon a successful reconnection.
			this.socket.io.on("reconnect", (attempt) => {
				console.log(`[SocketTransport] on(reconnect) - ${attempt}`)
				this.connectionState = ConnectionState.CONNECTED

				if (this.options.onReconnect) {
					this.options.onReconnect(attempt)
				}
			})

			// https://socket.io/docs/v4/client-api/#event-reconnect_attempt
			// Fired upon an attempt to reconnect.
			this.socket.io.on("reconnect_attempt", (attempt) => {
				console.log(`[SocketTransport] on(reconnect_attempt) - ${attempt}`)
			})

			// https://socket.io/docs/v4/client-api/#event-reconnect_error
			// Fired upon a reconnection attempt error.
			this.socket.io.on("reconnect_error", (error) => {
				console.error(`[SocketTransport] on(reconnect_error): ${error.message}`)
			})

			// https://socket.io/docs/v4/client-api/#event-reconnect_failed
			// Fired when couldn't reconnect within `reconnectionAttempts`.
			// Since we use infinite retries, this should never fire.
			this.socket.io.on("reconnect_failed", () => {
				console.error(`[SocketTransport] on(reconnect_failed) - giving up`)
				this.connectionState = ConnectionState.FAILED
			})

			// This is a custom event fired by the server.
			this.socket.on("auth_error", (error) => {
				console.error(`[SocketTransport] on (auth_error):`, error)

				if (connectionTimeout && this.connectionState !== ConnectionState.CONNECTED) {
					clearTimeout(connectionTimeout)
					connectionTimeout = null
					reject(new Error(error.message || "Authentication failed"))
				}
			})
		})
	}

	public async disconnect(): Promise<void> {
		console.log(`[SocketTransport] Disconnecting...`)

		if (this.retryTimeout) {
			clearTimeout(this.retryTimeout)
			this.retryTimeout = null
		}

		if (this.socket) {
			this.socket.removeAllListeners()
			this.socket.disconnect()
			this.socket = null
		}

		this.connectionState = ConnectionState.DISCONNECTED
		console.log(`[SocketTransport] Disconnected`)
	}

	public getSocket(): Socket | null {
		return this.socket
	}

	public getConnectionState(): ConnectionState {
		return this.connectionState
	}

	public isConnected(): boolean {
		return this.connectionState === ConnectionState.CONNECTED && this.socket?.connected === true
	}

	public async reconnect(): Promise<void> {
		console.log(`[SocketTransport] Manually reconnecting...`)

		if (this.connectionState === ConnectionState.CONNECTED) {
			console.log(`[SocketTransport] Already connected`)
			return
		}

		this.hasConnectedOnce = false
		await this.disconnect()
		await this.connect()
	}
}
