import { Logger } from "@/shared/services/Logger"

/**
 * Callbacks that the reconnect handler uses to interact with McpHub.
 * Injecting these allow the handler to be tested in isolation.
 */
export interface ReconnectCallbacks {
	/** Returns the current connection object, or undefined if it no longer exists */
	findConnection: () => { server: { status: string; disabled?: boolean; oauthRequired?: boolean } } | undefined
	/** Tears down the existing connection */
	deleteConnection: () => Promise<void>
	/** Establishes a new connection */
	connectToServer: () => Promise<void>
	/** Pushes updated server state to the webview */
	notifyWebviewOfServerChanges: () => Promise<void>
	/** Appends an error message to the connection's server object */
	appendErrorMessage: (connection: { server: { status: string } }, message: string) => void
	/** Awaitable delay — injected so tests can substitute a zero-delay or fake timer */
	delay: (ms: number) => Promise<void>
	/**
	 * Reads current settings fresh and returns whether this server is still
	 * configured, enabled, and defined with the same connection-relevant
	 * config this handler's connectToServer callback would reconnect with.
	 * Checked before every reconnect attempt so a retry can't resurrect a
	 * server the user removed or disabled — or an obsolete config the user
	 * changed — during a backoff delay. Should return true when settings
	 * can't be read: a transient read failure must not kill the reconnect
	 * chain.
	 */
	isStillWanted: () => Promise<boolean>
}

/**
 * Configuration for the reconnection strategy.
 */
export interface ReconnectConfig {
	/** Maximum number of consecutive reconnect attempts before giving up */
	maxAttempts: number
	/** Returns the delay in milliseconds for a given attempt (0-based). */
	getDelayMs: (attempt: number) => number
}

/** Default configuration: up to 6 attempts with exponential backoff starting at 2 s. */
export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
	maxAttempts: 6,
	getDelayMs: (attempt: number) => 2000 * 2 ** attempt,
}

/** Attempts/delay for publishing server state after a successful reconnect. */
const PUBLISH_ATTEMPTS = 3
const PUBLISH_RETRY_DELAY_MS = 1000

/**
 * Manages reconnection logic for a single StreamableHTTP MCP transport.
 *
 * Each instance tracks its own attempt counter. When the transport's `onerror`
 * fires, call {@link handleError}. The handler will:
 *
 * 1. Skip if the connection is disabled or already reconnecting.
 * 2. Wait with exponential backoff.
 * 3. Tear down and re-establish the connection.
 * 4. Reset the counter on success.
 * 5. After exhausting retries, mark the server as disconnected.
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

	/** Number of consecutive reconnect attempts so far */
	get attemptCount(): number {
		return this.attempts
	}

	/** Reset the attempt counter (e.g. after a successful long-lived connection) */
	resetAttempts(): void {
		this.attempts = 0
	}

	/**
	 * Publish server state to the webview, retrying transient failures up to
	 * `attempts` times. Never throws: handleError runs from transport.onerror
	 * with its promise discarded, so a rejection here would surface as an
	 * unhandled rejection — and a publication failure must never be confused
	 * with a transport failure.
	 */
	private async publishServerChanges(attempts = 1): Promise<void> {
		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				await this.callbacks.notifyWebviewOfServerChanges()
				return
			} catch (error) {
				Logger.error(`Failed to publish server state for "${this.serverName}" (attempt ${attempt}/${attempts}):`, error)
				if (attempt < attempts) {
					await this.callbacks.delay(PUBLISH_RETRY_DELAY_MS)
				}
			}
		}
	}

	/**
	 * Handle a transport error. Call this from `transport.onerror`.
	 */
	async handleError(error: unknown): Promise<void> {
		Logger.error(`Transport error for "${this.serverName}":`, error)

		const connection = this.callbacks.findConnection()
		if (!connection) {
			return
		}

		// Don't retry if intentionally disabled or already mid-reconnect
		if (connection.server.disabled || connection.server.status === "connecting") {
			return
		}

		if (this.attempts >= this.config.maxAttempts) {
			// Max retries exhausted
			Logger.error(
				`StreamableHTTP max reconnect attempts (${this.config.maxAttempts}) ` +
					`exhausted for "${this.serverName}". Server marked as disconnected.`,
			)
			connection.server.status = "disconnected"
			this.callbacks.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
			// Terminal state: no further publish will come from this handler,
			// so retry rather than risk leaving consumers on "connecting"
			await this.publishServerChanges(PUBLISH_ATTEMPTS)
			return
		}

		// First attempt: backoff, verify staleness, then delete + connect.
		// Subsequent attempts (on connectToServer failure) just backoff + connect.
		const initialDelay = this.config.getDelayMs(this.attempts)
		this.attempts++
		Logger.log(
			`StreamableHTTP transport error for "${this.serverName}", attempting reconnect ` +
				`${this.attempts}/${this.config.maxAttempts} in ${initialDelay / 1000}s...`,
		)

		connection.server.status = "connecting"
		await this.publishServerChanges()

		await this.callbacks.delay(initialDelay)

		// Verify connection still exists and hasn't been replaced during the delay
		const currentConnection = this.callbacks.findConnection()
		if (!currentConnection || currentConnection !== connection) {
			return
		}

		// Tear down the old connection, then retry connectToServer in a loop.
		// We loop here instead of relying on the new transport's onerror because
		// connectToServer() may throw before a new transport/error-handler is
		// established, which would silently break the retry chain.
		await this.callbacks.deleteConnection()

		while (this.attempts <= this.config.maxAttempts) {
			// Revalidate before every attempt: during the preceding await
			// (teardown or a backoff delay) another path — the settings
			// watcher, an RPC — may have installed a replacement connection,
			// or settings may have removed/disabled the server. Proceeding
			// would displace the replacement without closing it (leaking its
			// transport) or resurrect a server the user removed. Ordinary
			// "disconnected" connections are NOT replacements: a failed
			// connectToServer() (our own retry or another path's attempt)
			// leaves one behind with its client already closed, so retrying
			// past it displaces nothing live. The exception is an
			// OAuth-required connection (oauthRequired: true): it is also
			// "disconnected" but deliberately retains a live
			// client/transport/authProvider for when the user authenticates,
			// and displacing it would orphan that session.
			const existing = this.callbacks.findConnection()
			if (
				existing &&
				existing !== connection &&
				(existing.server.status !== "disconnected" || existing.server.oauthRequired)
			) {
				Logger.log(
					`StreamableHTTP reconnect aborted for "${this.serverName}": ` +
						`another path installed a replacement connection (status: ${existing.server.status})`,
				)
				return
			}
			if (!(await this.callbacks.isStillWanted())) {
				Logger.log(`StreamableHTTP reconnect aborted for "${this.serverName}": server no longer configured or disabled`)
				return
			}

			try {
				await this.callbacks.connectToServer()
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
					continue
				}
				break
			}

			Logger.log(`StreamableHTTP reconnect succeeded for "${this.serverName}"`)
			this.attempts = 0
			// connectToServer() loads fresh lists but doesn't publish them;
			// without this, the webview keeps showing "connecting" and
			// consumers keep the pre-reconnect capabilities. Kept outside the
			// connect try/catch — a publication failure must not be treated
			// as a transport failure and restart the already-live connection —
			// and retried so a transient failure doesn't leave consumers
			// stuck on "connecting" with pre-reconnect capabilities.
			await this.publishServerChanges(PUBLISH_ATTEMPTS)
			return
		}

		// All retry attempts exhausted during the connect loop.
		Logger.error(
			`StreamableHTTP max reconnect attempts (${this.config.maxAttempts}) ` +
				`exhausted for "${this.serverName}". Server marked as disconnected.`,
		)
		// The old connection was deleted; check if connectToServer left a partial one.
		const exhaustedConnection = this.callbacks.findConnection()
		if (exhaustedConnection) {
			exhaustedConnection.server.status = "disconnected"
			this.callbacks.appendErrorMessage(exhaustedConnection, error instanceof Error ? error.message : `${error}`)
		}
		// Terminal state — same rationale as the early-exhausted path above
		await this.publishServerChanges(PUBLISH_ATTEMPTS)
	}
}
