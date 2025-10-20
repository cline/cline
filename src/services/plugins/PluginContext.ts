/**
 * Plugin Context Implementation
 *
 * Provides isolated execution context for plugins with safe service boundaries.
 * No direct access to VSCode API or internal Cline state.
 */

import axios, { AxiosError } from "axios"
import * as vscode from "vscode"
import { HttpResponse, PluginContext, PluginHttpClient, PluginLogger, PluginStorage, RequestOptions } from "./types"

/**
 * Configuration for creating a plugin context
 */
export interface PluginContextConfig {
	/** Plugin ID for scoping logs and storage */
	pluginId: string

	/** Current task ID */
	taskId: string

	/** Current task mode */
	taskMode: "plan" | "act"

	/** Working directory for the task */
	workingDirectory: string

	/** VS Code extension context for storage */
	extensionContext: vscode.ExtensionContext

	/** Callback to send notifications to user */
	notifyCallback: (message: string) => void

	/** Callback to request input from user */
	requestInputCallback: (prompt: string) => Promise<string>
}

/**
 * Rate limiter for HTTP requests
 */
class HttpRateLimiter {
	private requestTimestamps: number[] = []
	private readonly maxRequestsPerMinute = 60
	private readonly windowMs = 60000 // 1 minute

	canMakeRequest(): boolean {
		const now = Date.now()
		// Remove timestamps older than window
		this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < this.windowMs)

		if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
			return false
		}

		this.requestTimestamps.push(now)
		return true
	}

	getRemainingRequests(): number {
		const now = Date.now()
		this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < this.windowMs)
		return Math.max(0, this.maxRequestsPerMinute - this.requestTimestamps.length)
	}
}

/**
 * Scoped logger implementation for plugins
 */
class PluginLoggerImpl implements PluginLogger {
	constructor(
		private pluginId: string,
		private outputChannel: vscode.OutputChannel,
	) {}

	debug(message: string, data?: any): void {
		this.log("DEBUG", message, data)
	}

	info(message: string, data?: any): void {
		this.log("INFO", message, data)
	}

	warn(message: string, data?: any): void {
		this.log("WARN", message, data)
	}

	error(message: string, data?: any): void {
		this.log("ERROR", message, data)
	}

	private log(level: string, message: string, data?: any): void {
		const timestamp = new Date().toISOString()
		const prefix = `[${timestamp}] [${this.pluginId}] [${level}]`

		if (data !== undefined) {
			const dataStr = typeof data === "object" ? JSON.stringify(data, null, 2) : String(data)
			this.outputChannel.appendLine(`${prefix} ${message}\n${dataStr}`)
		} else {
			this.outputChannel.appendLine(`${prefix} ${message}`)
		}
	}
}

/**
 * Plugin-scoped storage implementation
 */
class PluginStorageImpl implements PluginStorage {
	private readonly storageKeyPrefix: string

	constructor(
		private pluginId: string,
		private globalState: vscode.Memento,
	) {
		this.storageKeyPrefix = `plugin_${pluginId}_`
	}

	async get<T>(key: string): Promise<T | undefined> {
		const fullKey = this.getFullKey(key)
		return this.globalState.get<T>(fullKey)
	}

	async set<T>(key: string, value: T): Promise<void> {
		const fullKey = this.getFullKey(key)
		await this.globalState.update(fullKey, value)
	}

	async delete(key: string): Promise<void> {
		const fullKey = this.getFullKey(key)
		await this.globalState.update(fullKey, undefined)
	}

	async clear(): Promise<void> {
		const keys = this.globalState.keys()
		const pluginKeys = keys.filter((k) => k.startsWith(this.storageKeyPrefix))

		for (const key of pluginKeys) {
			await this.globalState.update(key, undefined)
		}
	}

	private getFullKey(key: string): string {
		return `${this.storageKeyPrefix}${key}`
	}
}

/**
 * Rate-limited HTTP client implementation
 */
class PluginHttpClientImpl implements PluginHttpClient {
	private rateLimiter = new HttpRateLimiter()
	private readonly defaultTimeout = 30000 // 30 seconds

	constructor(private pluginId: string) {}

	async get(url: string, options?: RequestOptions): Promise<HttpResponse> {
		return this.request("GET", url, undefined, options)
	}

	async post(url: string, data?: any, options?: RequestOptions): Promise<HttpResponse> {
		return this.request("POST", url, data, options)
	}

	private async request(method: "GET" | "POST", url: string, data?: any, options?: RequestOptions): Promise<HttpResponse> {
		// Check rate limit
		if (!this.rateLimiter.canMakeRequest()) {
			throw new Error(
				`Rate limit exceeded for plugin '${this.pluginId}'. ` +
					`Maximum 60 requests per minute allowed. ` +
					`Try again in a few seconds.`,
			)
		}

		// Validate URL
		try {
			new URL(url)
		} catch (error) {
			throw new Error(`Invalid URL: ${url}`)
		}

		// Ensure HTTPS for external requests
		const urlObj = new URL(url)
		if (urlObj.protocol === "http:" && !this.isLocalhost(urlObj.hostname)) {
			throw new Error(`Plugin HTTP client requires HTTPS for external requests. ` + `Use https:// instead of http://`)
		}

		try {
			const timeout = options?.timeout ?? this.defaultTimeout
			const response = await axios({
				method,
				url,
				data,
				headers: options?.headers,
				timeout,
				validateStatus: () => true, // Don't throw on any status code
			})

			return {
				status: response.status,
				data: response.data,
				headers: response.headers as Record<string, string>,
			}
		} catch (error) {
			if (axios.isAxiosError(error)) {
				const axiosError = error as AxiosError
				if (axiosError.code === "ECONNABORTED") {
					throw new Error(`Request timeout after ${options?.timeout ?? this.defaultTimeout}ms`)
				}
				throw new Error(`HTTP request failed: ${axiosError.message}`)
			}
			throw error
		}
	}

	private isLocalhost(hostname: string): boolean {
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
	}
}

/**
 * Create a plugin context with safe service boundaries
 */
export function createPluginContext(config: PluginContextConfig): PluginContext {
	// Create output channel for plugin logs
	const outputChannel = vscode.window.createOutputChannel(`Cline Plugin: ${config.pluginId}`)

	// Create service implementations
	const logger = new PluginLoggerImpl(config.pluginId, outputChannel)
	const storage = new PluginStorageImpl(config.pluginId, config.extensionContext.globalState)
	const http = new PluginHttpClientImpl(config.pluginId)

	// Return context with security boundaries
	return {
		taskId: config.taskId,
		taskMode: config.taskMode,
		workingDirectory: config.workingDirectory,
		logger,
		storage,
		http,
		notify: config.notifyCallback,
		requestInput: config.requestInputCallback,
	}
}

/**
 * Dispose of resources associated with a plugin context
 */
export function disposePluginContext(context: PluginContext): void {
	// Clean up any resources
	// Note: Output channels are managed by VS Code and don't need explicit disposal
	// Storage is persisted in VS Code's global state
}
