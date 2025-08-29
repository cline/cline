import type { Socket } from "socket.io-client"

/**
 * Abstract base class for communication channels in the bridge system.
 * Provides common functionality for bidirectional communication between
 * the VSCode extension and web application.
 *
 * @template TCommand - Type of commands this channel can receive.
 * @template TEvent - Type of events this channel can publish.
 */
export abstract class BaseChannel<TCommand = unknown, TEventName extends string = string, TEventData = unknown> {
	protected socket: Socket | null = null
	protected readonly instanceId: string

	constructor(instanceId: string) {
		this.instanceId = instanceId
	}

	/**
	 * Called when socket connects.
	 */
	public async onConnect(socket: Socket): Promise<void> {
		this.socket = socket
		await this.handleConnect(socket)
	}

	/**
	 * Called when socket disconnects.
	 */
	public onDisconnect(): void {
		this.socket = null
		this.handleDisconnect()
	}

	/**
	 * Called when socket reconnects.
	 */
	public async onReconnect(socket: Socket): Promise<void> {
		this.socket = socket
		await this.handleReconnect(socket)
	}

	/**
	 * Cleanup resources.
	 */
	public async cleanup(socket: Socket | null): Promise<void> {
		if (socket) {
			await this.handleCleanup(socket)
		}

		this.socket = null
	}

	/**
	 * Emit a socket event with error handling.
	 */
	protected publish<Params extends object>(
		eventName: TEventName,
		data: TEventData,
		callback?: (params: Params) => void,
	): boolean {
		if (!this.socket) {
			console.error(`[${this.constructor.name}#emit] socket not available for ${eventName}`)
			return false
		}

		try {
			// console.log(`[${this.constructor.name}#emit] emit() -> ${eventName}`, data)
			this.socket.emit(eventName, data, callback)

			return true
		} catch (error) {
			console.error(
				`[${this.constructor.name}#emit] emit() failed -> ${eventName}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)

			return false
		}
	}

	/**
	 * Handle incoming commands - must be implemented by subclasses.
	 */
	public abstract handleCommand(command: TCommand): Promise<void>

	/**
	 * Handle connection-specific logic.
	 */
	protected abstract handleConnect(socket: Socket): Promise<void>

	/**
	 * Handle disconnection-specific logic.
	 */
	protected handleDisconnect(): void {
		// Default implementation - can be overridden.
	}

	/**
	 * Handle reconnection-specific logic.
	 */
	protected abstract handleReconnect(socket: Socket): Promise<void>

	/**
	 * Handle cleanup-specific logic.
	 */
	protected abstract handleCleanup(socket: Socket): Promise<void>
}
