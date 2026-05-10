import { Logger } from "@services/logging/Logger"

/**
 * Callbacks that the reconnect handler uses to interact with McpHub.
 */
export interface ReconnectCallbacks {
	findConnection: () => { server: { status: string; disabled?: boolean } } | undefined
	deleteConnection: () => Promise<void>
	connectToServer: () => Promise<void>
	notifyWebviewOfServerChanges: () => Promise<void>
	appendErrorMessage: (connection: { server: { status: string } }, message: string) => void
	delay: (ms: number) => Promise<void>
}

export interface ReconnectConfig {
	maxAttempts: number
	getDelayMs: (attempt: number) => number
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
	maxAttempts: 6,
	getDelayMs: (attempt: number) => 2000 * 2 ** attempt,
}

/**
 * Manages reconnection logic for a single StreamableHTTP MCP transport.
 * Ported from upstream Cline v3.71.0 (#9642).
 */
export class StreamableHttpReconnectHandler {
	private attempts = 0
	private readonly serverName: string
	private readonly config: ReconnectConfig
	private readonly callbacks: ReconnectCallbacks

	constructor(serverName: string, callbacks: ReconnectCallbacks, config: ReconnectConfig = DEFAULT_RECONNECT_CONFIG) {
		this.serverName = serverName
		this.callbacks = callbacks
		this.config = config
	}

	get attemptCount(): number {
		return this.attempts
	}

	resetAttempts(): void {
		this.attempts = 0
	}

	async handleError(error: unknown): Promise<void> {
		Logger.error(`Transport error for "${this.serverName}":`, error instanceof Error ? error : undefined)

		const connection = this.callbacks.findConnection()
		if (!connection) {
			return
		}

		if (connection.server.disabled || connection.server.status === "connecting") {
			return
		}

		if (this.attempts >= this.config.maxAttempts) {
			Logger.error(
				`StreamableHTTP max reconnect attempts (${this.config.maxAttempts}) ` +
					`exhausted for "${this.serverName}". Server marked as disconnected.`,
			)
			connection.server.status = "disconnected"
			this.callbacks.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
			await this.callbacks.notifyWebviewOfServerChanges()
			return
		}

		const initialDelay = this.config.getDelayMs(this.attempts)
		this.attempts++
		Logger.log(
			`StreamableHTTP transport error for "${this.serverName}", attempting reconnect ` +
				`${this.attempts}/${this.config.maxAttempts} in ${initialDelay / 1000}s...`,
		)

		connection.server.status = "connecting"
		await this.callbacks.notifyWebviewOfServerChanges()
		await this.callbacks.delay(initialDelay)

		const currentConnection = this.callbacks.findConnection()
		if (!currentConnection || currentConnection !== connection) {
			return
		}

		await this.callbacks.deleteConnection()

		while (this.attempts <= this.config.maxAttempts) {
			try {
				await this.callbacks.connectToServer()
				Logger.log(`StreamableHTTP reconnect succeeded for "${this.serverName}"`)
				this.attempts = 0
				return
			} catch (reconnectError) {
				Logger.error(`StreamableHTTP reconnect failed for "${this.serverName}":`, reconnectError)
				if (this.attempts < this.config.maxAttempts) {
					const retryDelay = this.config.getDelayMs(this.attempts)
					this.attempts++
					Logger.log(
						`StreamableHTTP retrying reconnect ${this.attempts}/${this.config.maxAttempts} ` +
							`for "${this.serverName}" in ${retryDelay / 1000}s...`,
					)
					await this.callbacks.delay(retryDelay)
				} else {
					break
				}
			}
		}

		Logger.error(
			`StreamableHTTP max reconnect attempts (${this.config.maxAttempts}) ` +
				`exhausted for "${this.serverName}". Server marked as disconnected.`,
		)
		const exhaustedConnection = this.callbacks.findConnection()
		if (exhaustedConnection) {
			exhaustedConnection.server.status = "disconnected"
			this.callbacks.appendErrorMessage(exhaustedConnection, error instanceof Error ? error.message : `${error}`)
			await this.callbacks.notifyWebviewOfServerChanges()
		}
	}
}
