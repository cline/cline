import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import { sendMcpServersUpdate } from "@core/controller/mcp/subscribeToMcpServers"
import { GlobalFileNames } from "@core/storage/disk"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
	CallToolResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import {
	DEFAULT_MCP_TIMEOUT_SECONDS,
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpServer,
	McpTool,
	McpToolCallResponse,
	MIN_MCP_TIMEOUT_SECONDS,
} from "@shared/mcp"
import { convertMcpServersToProtoMcpServers } from "@shared/proto-conversions/mcp/mcp-server-conversion"
import { fileExistsAtPath } from "@utils/fs"
import { secondsToMs } from "@utils/time"
import chokidar, { FSWatcher } from "chokidar"
import deepEqual from "fast-deep-equal"
import * as fs from "fs/promises"
import { nanoid } from "nanoid"
import * as path from "path"
import ReconnectingEventSource from "reconnecting-eventsource"
import { z } from "zod"
import { HostProvider } from "@/hosts/host-provider"
import { fetch } from "@/shared/net"
import { ShowMessageType } from "@/shared/proto/host/window"
import { getServerAuthHash } from "@/utils/mcpAuth"
import { TelemetryService } from "../telemetry/TelemetryService"
import { DEFAULT_REQUEST_TIMEOUT_MS } from "./constants"
import { McpOAuthManager } from "./McpOAuthManager"
import { BaseConfigSchema, McpSettingsSchema, ServerConfigSchema } from "./schemas"
import { McpConnection, McpServerConfig, Transport } from "./types"
export class McpHub {
	getMcpServersPath: () => Promise<string>
	private getSettingsDirectoryPath: () => Promise<string>
	private clientVersion: string
	private telemetryService: TelemetryService
	private mcpOAuthManager: McpOAuthManager

	private settingsWatcher?: FSWatcher
	private fileWatchers: Map<string, FSWatcher> = new Map()
	connections: McpConnection[] = []
	isConnecting: boolean = false

	/**
	 * Map of unique keys to each connected server names
	 */
	private static mcpServerKeys = new Map<string, string>()

	// Store notifications for display in chat
	private pendingNotifications: Array<{
		serverName: string
		level: string
		message: string
		timestamp: number
	}> = []

	// Callback for sending notifications to active task
	private notificationCallback?: (serverName: string, level: string, message: string) => void

	constructor(
		getMcpServersPath: () => Promise<string>,
		getSettingsDirectoryPath: () => Promise<string>,
		clientVersion: string,
		telemetryService: TelemetryService,
	) {
		this.getMcpServersPath = getMcpServersPath
		this.getSettingsDirectoryPath = getSettingsDirectoryPath
		this.clientVersion = clientVersion
		this.telemetryService = telemetryService
		this.mcpOAuthManager = new McpOAuthManager()
		this.watchMcpSettingsFile()
		this.initializeMcpServers()
	}

	getServers(): McpServer[] {
		// Only return enabled servers

		return this.connections.filter((conn) => !conn.server.disabled).map((conn) => conn.server)
	}

	/**
	 * Get the MCP server name from its unique key.
	 * If the key is not found, return the key itself.
	 */
	public static getMcpServerByKey(key: string): string {
		return McpHub.mcpServerKeys.get(key) || key
	}

	/**
	 * Create a unique key for an MCP server based on its name.
	 * This avoids making a tool name too long while still ensuring uniqueness.
	 */
	private getMcpServerKey(server: string): string {
		// Reuse existing key if server is already registered
		for (const [existingKey, existingServer] of McpHub.mcpServerKeys.entries()) {
			if (existingServer === server) {
				return existingKey
			}
		}
		// Generate a short 6-character unique ID for the server
		// Add c prefix to ensure it starts with a letter (for compatibility with Gemini)
		// Only use the first 5 characters of nanoid to keep it short
		const uid = "c" + nanoid(5)
		McpHub.mcpServerKeys.set(uid, server)
		return uid
	}

	async getMcpSettingsFilePath(): Promise<string> {
		const mcpSettingsFilePath = path.join(await this.getSettingsDirectoryPath(), GlobalFileNames.mcpSettings)
		const fileExists = await fileExistsAtPath(mcpSettingsFilePath)
		if (!fileExists) {
			await fs.writeFile(
				mcpSettingsFilePath,
				`{
  "mcpServers": {
    
  }
}`,
			)
		}
		return mcpSettingsFilePath
	}

	private async readAndValidateMcpSettingsFile(): Promise<z.infer<typeof McpSettingsSchema> | undefined> {
		try {
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")

			let config: any

			// Parse JSON file content
			try {
				config = JSON.parse(content)
			} catch (_error) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Invalid MCP settings format. Please ensure your settings follow the correct JSON format.",
				})
				return undefined
			}

			// Validate against schema
			const result = McpSettingsSchema.safeParse(config)
			if (!result.success) {
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: "Invalid MCP settings schema.",
				})
				return undefined
			}

			return result.data
		} catch (error) {
			console.error("Failed to read MCP settings:", error)
			return undefined
		}
	}

	private async watchMcpSettingsFile(): Promise<void> {
		const settingsPath = await this.getMcpSettingsFilePath()

		this.settingsWatcher = chokidar.watch(settingsPath, {
			persistent: true, // Keep the process running as long as files are being watched
			ignoreInitial: true, // Don't fire 'add' events when discovering the file initially
			awaitWriteFinish: {
				// Wait for writes to finish before emitting events (handles chunked writes)
				stabilityThreshold: 100, // Wait 100ms for file size to remain constant
				pollInterval: 100, // Check file size every 100ms while waiting for stability
			},
			atomic: true, // Handle atomic writes where editors write to a temp file then rename (prevents duplicate events)
		})

		this.settingsWatcher.on("change", async () => {
			const settings = await this.readAndValidateMcpSettingsFile()
			if (settings) {
				try {
					await this.updateServerConnections(settings.mcpServers)
				} catch (error) {
					console.error("Failed to process MCP settings change:", error)
				}
			}
		})

		this.settingsWatcher.on("error", (error) => {
			console.error("Error watching MCP settings file:", error)
		})
	}

	private async initializeMcpServers(): Promise<void> {
		const settings = await this.readAndValidateMcpSettingsFile()
		if (settings) {
			await this.updateServerConnections(settings.mcpServers)
		}
	}

	private findConnection(name: string, _source: "rpc" | "internal"): McpConnection | undefined {
		return this.connections.find((conn) => conn.server.name === name)
	}

	private async connectToServer(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "rpc" | "internal",
	): Promise<void> {
		// Remove existing connection if it exists (should never happen, the connection should be deleted beforehand)
		this.connections = this.connections.filter((conn) => conn.server.name !== name)

		if (config.disabled) {
			//console.log(`[MCP Debug] Creating disabled connection object for server "${name}"`)
			// Create a connection object for disabled server so it appears in UI
			const disabledConnection: McpConnection = {
				server: {
					name,
					config: JSON.stringify(config),
					status: "disconnected",
					disabled: true,
				},
				client: null as unknown as Client,
				transport: null as unknown as Transport,
			}
			this.connections.push(disabledConnection)
			return
		}

		try {
			// Each MCP server requires its own transport connection and has unique capabilities, configurations, and error handling. Having separate clients also allows proper scoping of resources/tools and independent server management like reconnection.
			const client = new Client(
				{
					name: "Cline",
					version: this.clientVersion,
				},
				{
					capabilities: {},
				},
			)

			let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

			// Create OAuth provider for remote transports (SSE and HTTP)
			const authProvider =
				config.type === "sse" || config.type === "streamableHttp"
					? await this.mcpOAuthManager.getOrCreateProvider(name, config.url)
					: undefined

			switch (config.type) {
				case "stdio": {
					transport = new StdioClientTransport({
						command: config.command,
						args: config.args,
						cwd: config.cwd,
						env: {
							// ...(config.env ? await injectEnv(config.env) : {}), // Commented out as injectEnv is not found
							...getDefaultEnvironment(),
							...(config.env || {}), // Use config.env directly or an empty object
						},
						stderr: "pipe",
					})

					transport.onerror = async (error) => {
						console.error(`Transport error for "${name}":`, error)
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "disconnected"
							McpHub.mcpServerKeys.delete(connection.server.uid || name)
							this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
						}
						await this.notifyWebviewOfServerChanges()
					}

					transport.onclose = async () => {
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "disconnected"
							McpHub.mcpServerKeys.delete(connection.server.uid || name)
						}
						await this.notifyWebviewOfServerChanges()
					}

					await transport.start()
					const stderrStream = transport.stderr
					if (stderrStream) {
						stderrStream.on("data", async (data: Buffer) => {
							const output = data.toString()
							const isInfoLog = !/\berror\b/i.test(output)

							if (isInfoLog) {
								console.log(`Server "${name}" info:`, output)
							} else {
								console.error(`Server "${name}" stderr:`, output)
								const connection = this.findConnection(name, source)
								if (connection) {
									this.appendErrorMessage(connection, output)
									if (connection.server.status === "disconnected") {
										await this.notifyWebviewOfServerChanges()
									}
								}
							}
						})
					} else {
						console.error(`No stderr stream for ${name}`)
					}
					transport.start = async () => {}
					break
				}
				case "sse": {
					const sseOptions = {
						authProvider,
						requestInit: {
							headers: config.headers,
						},
					}
					const reconnectingEventSourceOptions = {
						max_retry_time: 5000,
						withCredentials: !!config.headers?.["Authorization"],
						// IMPORTANT: Custom fetch function is required for SSE with OAuth
						// When we provide eventSourceInit, we override the SDK's default fetch
						// The SDK's default would call _commonHeaders() for auth, but since we're
						// overriding it, we must provide our own fetch that:
						// 1. Calls authProvider.tokens() dynamically (not captured once)
						// 2. Gets fresh tokens for each connection/reconnection
						// 3. Allows the SDK to auto-refresh expired tokens
						// Without this, tokens would be stale and fail after expiry
						fetch: authProvider
							? async (url: string | URL, init?: RequestInit) => {
									const tokens = await authProvider.tokens() // Dynamic - gets fresh tokens
									const headers = new Headers(init?.headers)
									if (tokens?.access_token) {
										headers.set("Authorization", `Bearer ${tokens.access_token}`)
									}
									return fetch(url.toString(), { ...init, headers })
								}
							: undefined,
					}
					// Use ReconnectingEventSource for auto-reconnection on connection drops
					global.EventSource = ReconnectingEventSource
					transport = new SSEClientTransport(new URL(config.url), {
						...sseOptions,
						eventSourceInit: reconnectingEventSourceOptions,
					})

					transport.onerror = async (error) => {
						console.error(`Transport error for "${name}":`, error)
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "disconnected"
							McpHub.mcpServerKeys.delete(connection.server.uid || name)
							this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
						}
						await this.notifyWebviewOfServerChanges()
					}
					break
				}
				case "streamableHttp": {
					transport = new StreamableHTTPClientTransport(new URL(config.url), {
						authProvider,
						requestInit: {
							headers: config.headers ?? undefined,
						},
					})
					transport.onerror = async (error) => {
						console.error(`Transport error for "${name}":`, error)
						const connection = this.findConnection(name, source)
						if (connection) {
							connection.server.status = "disconnected"
							McpHub.mcpServerKeys.delete(connection.server.uid || name)
							this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
						}
						await this.notifyWebviewOfServerChanges()
					}
					break
				}
				default:
					throw new Error(`Unknown transport type: ${(config as any).type}`)
			}

			const connection: McpConnection = {
				server: {
					name,
					config: JSON.stringify(config),
					status: "connecting",
					disabled: config.disabled,
					uid: this.getMcpServerKey(name),
					oauthRequired: false,
					oauthAuthStatus: "authenticated",
				},
				client,
				transport,
				authProvider,
			}
			this.connections.push(connection)

			// Connect - wrap in try-catch to detect OAuth requirement
			try {
				await client.connect(transport)
			} catch (error) {
				if (error instanceof UnauthorizedError) {
					// Server requires OAuth authentication
					console.log(`Server "${name}" requires OAuth authentication`)
					const unauthConnection: McpConnection = {
						server: {
							name,
							config: JSON.stringify(config),
							status: "disconnected",
							disabled: false,
							oauthRequired: true,
							oauthAuthStatus: "unauthenticated",
							error: "This MCP server requires authentication to get started.",
							uid: this.getMcpServerKey(name),
						},
						client,
						transport,
						authProvider, // CRITICAL: Keep authProvider so it's available when user authenticates!
					}
					// Replace the connection with unauthenticated version
					this.connections = this.connections.filter((conn) => conn.server.name !== name)
					this.connections.push(unauthConnection)
					await this.notifyWebviewOfServerChanges()
					return // Don't throw, just mark as needs auth
				}
				// Re-throw other errors
				throw error
			}

			connection.server.status = "connected"
			connection.server.error = ""

			// Register notification handler for real-time messages
			//console.log(`[MCP Debug] Setting up notification handlers for server: ${name}`)
			//console.log(`[MCP Debug] Client instance:`, connection.client)
			//console.log(`[MCP Debug] Transport type:`, config.type)

			// Try to set notification handler using the client's method
			try {
				// Import the notification schema from MCP SDK
				const { z } = await import("zod")

				// Define the notification schema for notifications/message
				const NotificationMessageSchema = z.object({
					method: z.literal("notifications/message"),
					params: z
						.object({
							level: z.enum(["debug", "info", "warning", "error"]).optional(),
							logger: z.string().optional(),
							data: z.string().optional(),
							message: z.string().optional(),
						})
						.optional(),
				})

				// Set the notification handler
				connection.client.setNotificationHandler(NotificationMessageSchema as any, async (notification: any) => {
					//console.log(`[MCP Notification] ${name}:`, JSON.stringify(notification, null, 2))

					const params = notification.params || {}
					const level = params.level || "info"
					const data = params.data || params.message || ""
					const logger = params.logger || ""

					//console.log(`[MCP Message Notification] ${name}: level=${level}, data=${data}, logger=${logger}`)

					// Format the message
					const message = logger ? `[${logger}] ${data}` : data

					// Send notification directly to active task if callback is set
					if (this.notificationCallback) {
						//console.log(`[MCP Debug] Sending notification to active task: ${message}`)
						this.notificationCallback(name, level, message)
					} else {
						// Fallback: store for later retrieval
						//console.log(`[MCP Debug] No active task, storing notification: ${message}`)
						this.pendingNotifications.push({
							serverName: name,
							level,
							message,
							timestamp: Date.now(),
						})
					}
				})
				//console.log(`[MCP Debug] Successfully set notifications/message handler for ${name}`)

				// Also set a fallback handler for any other notification types
				connection.client.fallbackNotificationHandler = async (notification: any) => {
					//console.log(`[MCP Fallback Notification] ${name}:`, JSON.stringify(notification, null, 2))

					// Show in VS Code for visibility
					HostProvider.window.showMessage({
						type: ShowMessageType.INFORMATION,
						message: `MCP ${name}: ${notification.method || "unknown"} - ${JSON.stringify(notification.params || {})}`,
					})
				}
				//console.log(`[MCP Debug] Successfully set fallback notification handler for ${name}`)
			} catch (error) {
				console.error(`[MCP Debug] Error setting notification handlers for ${name}:`, error)
			}

			// Initial fetch of tools and resources
			connection.server.tools = await this.fetchToolsList(name)
			connection.server.resources = await this.fetchResourcesList(name)
			connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name)
		} catch (error) {
			// Update status with error
			const connection = this.findConnection(name, source)
			if (connection) {
				connection.server.status = "disconnected"
				this.appendErrorMessage(connection, error instanceof Error ? error.message : String(error))
			}
			throw error
		}
	}

	private appendErrorMessage(connection: McpConnection, error: string) {
		const newError = connection.server.error ? `${connection.server.error}\n${error}` : error
		connection.server.error = newError //.slice(0, 800)
	}

	private async fetchToolsList(serverName: string): Promise<McpTool[]> {
		try {
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			if (!connection) {
				throw new Error(`No connection found for server: ${serverName}`)
			}

			// Disabled servers don't have clients, so return empty tools list
			if (connection.server.disabled || !connection.client) {
				return []
			}

			const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema, {
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			})

			// Get autoApprove settings
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)
			const autoApproveConfig = config.mcpServers[serverName]?.autoApprove || []

			// Mark tools as always allowed based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				autoApprove: autoApproveConfig.includes(tool.name),
			}))

			return tools
		} catch (error) {
			console.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourcesList(serverName: string): Promise<McpResource[]> {
		try {
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			// Disabled servers don't have clients, so return empty resources list
			if (!connection || connection.server.disabled || !connection.client) {
				return []
			}

			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema, {
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			})
			return response?.resources || []
		} catch (_error) {
			// console.error(`Failed to fetch resources for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourceTemplatesList(serverName: string): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			// Disabled servers don't have clients, so return empty resource templates list
			if (!connection || connection.server.disabled || !connection.client) {
				return []
			}

			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
				{
					timeout: DEFAULT_REQUEST_TIMEOUT_MS,
				},
			)

			return response?.resourceTemplates || []
		} catch (_error) {
			// console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}

	async deleteConnection(name: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === name)
		if (connection) {
			try {
				// Only close transport and client if they exist (disabled servers don't have them)
				if (connection.transport) {
					await connection.transport.close()
				}
				if (connection.client) {
					await connection.client.close()
				}
			} catch (error) {
				console.error(`Failed to close transport for ${name}:`, error)
			}
			this.connections = this.connections.filter((conn) => conn.server.name !== name)
		}
	}

	async clearOAuthForConnection(name: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === name)
		if (connection) {
			try {
				const config = JSON.parse(connection.server.config)
				if (config.url) {
					await this.mcpOAuthManager.clearServerAuth(name, config.url)
				}
			} catch (error) {
				console.error(`Failed to clear OAuth data for ${name}:`, error)
			}
		}
	}

	async updateServerConnectionsRPC(newServers: Record<string, McpServerConfig>): Promise<void> {
		this.isConnecting = true
		this.removeAllFileWatchers()
		const currentNames = new Set(this.connections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Delete removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				await this.deleteConnection(name)
				console.log(`Deleted MCP server: ${name}`)
			}
		}

		// Update or add servers
		for (const [name, config] of Object.entries(newServers)) {
			const currentConnection = this.connections.find((conn) => conn.server.name === name)

			if (!currentConnection) {
				// New server
				try {
					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.connectToServer(name, config, "rpc")
				} catch (error) {
					console.error(`Failed to connect to new MCP server ${name}:`, error)
				}
			} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed config
				try {
					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.deleteConnection(name) // Don't clear OAuth - just reconnecting with new config
					await this.connectToServer(name, config, "rpc")
					console.log(`Reconnected MCP server with updated config: ${name}`)
				} catch (error) {
					console.error(`Failed to reconnect MCP server ${name}:`, error)
				}
			}
			// If server exists with same config, do nothing
		}

		this.isConnecting = false
	}

	async updateServerConnections(newServers: Record<string, McpServerConfig>): Promise<void> {
		this.isConnecting = true
		this.removeAllFileWatchers()
		const currentNames = new Set(this.connections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Delete removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				await this.clearOAuthForConnection(name) // Clear OAuth data first
				await this.deleteConnection(name) // Then delete connection
				console.log(`Deleted MCP server: ${name}`)
			}
		}

		// Update or add servers
		for (const [name, config] of Object.entries(newServers)) {
			const currentConnection = this.connections.find((conn) => conn.server.name === name)

			if (!currentConnection) {
				// New server
				try {
					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.connectToServer(name, config, "internal")
				} catch (error) {
					console.error(`Failed to connect to new MCP server ${name}:`, error)
				}
			} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed config
				try {
					if (config.type === "stdio") {
						this.setupFileWatcher(name, config)
					}
					await this.deleteConnection(name)
					await this.connectToServer(name, config, "internal")
					console.log(`Reconnected MCP server with updated config: ${name}`)
				} catch (error) {
					console.error(`Failed to reconnect MCP server ${name}:`, error)
				}
			}
			// If server exists with same config, do nothing
		}
		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	private setupFileWatcher(name: string, config: Extract<McpServerConfig, { type: "stdio" }>) {
		const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
		if (filePath) {
			// we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor. The settings config is better suited for onDidSave since that will be manually updated by the user or Cline (and we want to detect save events, not every file change)
			const watcher = chokidar.watch(filePath, {
				// persistent: true,
				// ignoreInitial: true,
				// awaitWriteFinish: true, // This helps with atomic writes
			})

			watcher.on("change", () => {
				console.log(`Detected change in ${filePath}. Restarting server ${name}...`)
				this.restartConnection(name)
			})

			this.fileWatchers.set(name, watcher)
		}
	}

	private removeAllFileWatchers() {
		this.fileWatchers.forEach((watcher) => watcher.close())
		this.fileWatchers.clear()
	}

	async restartConnectionRPC(serverName: string): Promise<McpServer[]> {
		this.isConnecting = true

		// Get existing connection and update its status
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		const inMemoryConfig = connection?.server.config
		if (inMemoryConfig) {
			connection.server.status = "connecting"
			connection.server.error = ""
			await setTimeoutPromise(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName)
				// Try to connect again using existing config
				await this.connectToServer(serverName, JSON.parse(inMemoryConfig), "rpc")
			} catch (error) {
				console.error(`Failed to restart connection for ${serverName}:`, error)
			}
		}

		this.isConnecting = false

		const config = await this.readAndValidateMcpSettingsFile()
		if (!config) {
			throw new Error("Failed to read or validate MCP settings")
		}

		const serverOrder = Object.keys(config.mcpServers || {})
		return this.getSortedMcpServers(serverOrder)
	}

	async restartConnection(serverName: string): Promise<void> {
		this.isConnecting = true

		// Get existing connection and update its status
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		const config = connection?.server.config
		if (config) {
			HostProvider.window.showMessage({
				type: ShowMessageType.INFORMATION,
				message: `Restarting ${serverName} MCP server...`,
			})
			connection.server.status = "connecting"
			connection.server.error = ""
			await this.notifyWebviewOfServerChanges()
			await setTimeoutPromise(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName)
				// Try to connect again using existing config
				await this.connectToServer(serverName, JSON.parse(config), "internal")
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: `${serverName} MCP server connected`,
				})
			} catch (error) {
				console.error(`Failed to restart connection for ${serverName}:`, error)
				HostProvider.window.showMessage({
					type: ShowMessageType.ERROR,
					message: `Failed to connect to ${serverName} MCP server`,
				})
			}
		}

		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	/**
	 * Gets sorted MCP servers based on the order defined in settings
	 * @param serverOrder Array of server names in the order they appear in settings
	 * @returns Array of McpServer objects sorted according to settings order
	 */
	private getSortedMcpServers(serverOrder: string[]): McpServer[] {
		return [...this.connections]
			.sort((a, b) => {
				const indexA = serverOrder.indexOf(a.server.name)
				const indexB = serverOrder.indexOf(b.server.name)
				return indexA - indexB
			})
			.map((connection) => connection.server)
	}

	private async notifyWebviewOfServerChanges(): Promise<void> {
		// servers should always be sorted in the order they are defined in the settings file
		const settingsPath = await this.getMcpSettingsFilePath()
		const content = await fs.readFile(settingsPath, "utf-8")
		const config = JSON.parse(content)
		const serverOrder = Object.keys(config.mcpServers || {})

		// Get sorted servers
		const sortedServers = this.getSortedMcpServers(serverOrder)

		// Send update using gRPC stream
		await sendMcpServersUpdate({
			mcpServers: convertMcpServersToProtoMcpServers(sortedServers),
		})
	}

	async sendLatestMcpServers() {
		await this.notifyWebviewOfServerChanges()
	}

	async getLatestMcpServersRPC(): Promise<McpServer[]> {
		const settings = await this.readAndValidateMcpSettingsFile()
		if (!settings) {
			// Return empty array if settings can't be read or validated
			return []
		}

		const serverOrder = Object.keys(settings.mcpServers || {})
		return this.getSortedMcpServers(serverOrder)
	}

	// Using server

	// Public methods for server management

	public async toggleServerDisabledRPC(serverName: string, disabled: boolean): Promise<McpServer[]> {
		try {
			const config = await this.readAndValidateMcpSettingsFile()
			if (!config) {
				throw new Error("Failed to read or validate MCP settings")
			}

			if (config.mcpServers[serverName]) {
				config.mcpServers[serverName].disabled = disabled

				const settingsPath = await this.getMcpSettingsFilePath()
				await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

				const connection = this.connections.find((conn) => conn.server.name === serverName)
				if (connection) {
					connection.server.disabled = disabled
				}

				const serverOrder = Object.keys(config.mcpServers || {})
				return this.getSortedMcpServers(serverOrder)
			}
			console.error(`Server "${serverName}" not found in MCP configuration`)
			throw new Error(`Server "${serverName}" not found in MCP configuration`)
		} catch (error) {
			console.error("Failed to update server disabled state:", error)
			if (error instanceof Error) {
				console.error("Error details:", error.message, error.stack)
			}
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to update server state: ${error instanceof Error ? error.message : String(error)}`,
			})
			throw error
		}
	}

	async readResource(serverName: string, uri: string): Promise<McpResourceResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`No connection found for server: ${serverName}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}

		return await connection.client.request(
			{
				method: "resources/read",
				params: {
					uri,
				},
			},
			ReadResourceResultSchema,
		)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments: Record<string, unknown> | undefined,
		ulid: string,
	): Promise<McpToolCallResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(
				`No connection found for server: ${serverName}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
			)
		}

		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled and cannot be used`)
		}

		let timeout = secondsToMs(DEFAULT_MCP_TIMEOUT_SECONDS) // sdk expects ms

		try {
			const config = JSON.parse(connection.server.config)
			const parsedConfig = ServerConfigSchema.parse(config)
			timeout = secondsToMs(parsedConfig.timeout)
		} catch (error) {
			console.error(`Failed to parse timeout configuration for server ${serverName}: ${error}`)
		}

		this.telemetryService.captureMcpToolCall(
			ulid,
			serverName,
			toolName,
			"started",
			undefined,
			toolArguments ? Object.keys(toolArguments) : undefined,
		)

		try {
			const result = await connection.client.request(
				{
					method: "tools/call",
					params: {
						name: toolName,
						arguments: toolArguments,
					},
				},
				CallToolResultSchema,
				{
					timeout,
				},
			)

			this.telemetryService.captureMcpToolCall(
				ulid,
				serverName,
				toolName,
				"success",
				undefined,
				toolArguments ? Object.keys(toolArguments) : undefined,
			)

			return {
				...result,
				content: result.content ?? [],
			}
		} catch (error) {
			this.telemetryService.captureMcpToolCall(
				ulid,
				serverName,
				toolName,
				"error",
				error instanceof Error ? error.message : String(error),
				toolArguments ? Object.keys(toolArguments) : undefined,
			)
			throw error
		}
	}

	/**
	 * RPC variant of toggleToolAutoApprove that returns the updated servers instead of notifying the webview
	 * @param serverName The name of the MCP server
	 * @param toolNames Array of tool names to toggle auto-approve for
	 * @param shouldAllow Whether to enable or disable auto-approve
	 * @returns Array of updated MCP servers
	 */
	async toggleToolAutoApproveRPC(serverName: string, toolNames: string[], shouldAllow: boolean): Promise<McpServer[]> {
		try {
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)

			// Initialize autoApprove if it doesn't exist
			if (!config.mcpServers[serverName].autoApprove) {
				config.mcpServers[serverName].autoApprove = []
			}

			const autoApprove = config.mcpServers[serverName].autoApprove
			for (const toolName of toolNames) {
				const toolIndex = autoApprove.indexOf(toolName)

				if (shouldAllow && toolIndex === -1) {
					// Add tool to autoApprove list
					autoApprove.push(toolName)
				} else if (!shouldAllow && toolIndex !== -1) {
					// Remove tool from autoApprove list
					autoApprove.splice(toolIndex, 1)
				}
			}

			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

			// Update the tools list to reflect the change
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection && connection.server.tools) {
				// Update the autoApprove property of each tool in the in-memory server object
				connection.server.tools = connection.server.tools.map((tool) => ({
					...tool,
					autoApprove: autoApprove.includes(tool.name),
				}))
			}

			// Return sorted servers without notifying webview
			const serverOrder = Object.keys(config.mcpServers || {})
			return this.getSortedMcpServers(serverOrder)
		} catch (error) {
			console.error("Failed to update autoApprove settings:", error)
			throw error // Re-throw to ensure the error is properly handled
		}
	}

	async toggleToolAutoApprove(serverName: string, toolNames: string[], shouldAllow: boolean): Promise<void> {
		try {
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)

			// Initialize autoApprove if it doesn't exist
			if (!config.mcpServers[serverName].autoApprove) {
				config.mcpServers[serverName].autoApprove = []
			}

			const autoApprove = config.mcpServers[serverName].autoApprove
			for (const toolName of toolNames) {
				const toolIndex = autoApprove.indexOf(toolName)

				if (shouldAllow && toolIndex === -1) {
					// Add tool to autoApprove list
					autoApprove.push(toolName)
				} else if (!shouldAllow && toolIndex !== -1) {
					// Remove tool from autoApprove list
					autoApprove.splice(toolIndex, 1)
				}
			}

			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

			// Update the tools list to reflect the change
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection && connection.server.tools) {
				// Update the autoApprove property of each tool in the in-memory server object
				connection.server.tools = connection.server.tools.map((tool) => ({
					...tool,
					autoApprove: autoApprove.includes(tool.name),
				}))
				await this.notifyWebviewOfServerChanges()
			}
		} catch (error) {
			console.error("Failed to update autoApprove settings:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to update autoApprove settings",
			})
			throw error // Re-throw to ensure the error is properly handled
		}
	}

	public async addRemoteServer(
		serverName: string,
		serverUrl: string,
		transportType: string = "streamableHttp",
	): Promise<McpServer[]> {
		try {
			const settings = await this.readAndValidateMcpSettingsFile()
			if (!settings) {
				throw new Error("Failed to read MCP settings")
			}

			if (settings.mcpServers[serverName]) {
				throw new Error(`An MCP server with the name "${serverName}" already exists`)
			}

			const urlValidation = z.string().url().safeParse(serverUrl)
			if (!urlValidation.success) {
				throw new Error(`Invalid server URL: ${serverUrl}. Please provide a valid URL.`)
			}

			const serverConfig = {
				url: serverUrl,
				type: transportType,
				disabled: false,
				autoApprove: [],
			}

			const parsedConfig = ServerConfigSchema.parse(serverConfig)

			settings.mcpServers[serverName] = parsedConfig
			const settingsPath = await this.getMcpSettingsFilePath()

			// We don't write the zod-transformed version to the file.
			// The above parse() call adds the transportType field to the server config
			// It would be fine if this was written, but we don't want to clutter up the file with internal details

			// ToDo: We could benefit from input / output types reflecting the non-transformed / transformed versions
			await fs.writeFile(
				settingsPath,
				JSON.stringify({ mcpServers: { ...settings.mcpServers, [serverName]: serverConfig } }, null, 2),
			)

			await this.updateServerConnectionsRPC(settings.mcpServers)

			const serverOrder = Object.keys(settings.mcpServers || {})
			return this.getSortedMcpServers(serverOrder)
		} catch (error) {
			console.error("Failed to add remote MCP server:", error)
			throw error
		}
	}

	/**
	 * RPC variant of deleteServer that returns the updated server list directly
	 * @param serverName The name of the server to delete
	 * @returns Array of remaining MCP servers
	 */
	public async deleteServerRPC(serverName: string): Promise<McpServer[]> {
		try {
			// Clear OAuth data BEFORE removing from config (while we still have the connection/URL)
			await this.clearOAuthForConnection(serverName)

			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)
			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			if (config.mcpServers[serverName]) {
				delete config.mcpServers[serverName]
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}
				await fs.writeFile(settingsPath, JSON.stringify(updatedConfig, null, 2))
				await this.updateServerConnectionsRPC(config.mcpServers)

				// Get the servers in their correct order from settings
				const serverOrder = Object.keys(config.mcpServers || {})
				return this.getSortedMcpServers(serverOrder)
			} else {
				throw new Error(`${serverName} not found in MCP configuration`)
			}
		} catch (error) {
			console.error(`Failed to delete MCP server: ${error instanceof Error ? error.message : String(error)}`)
			throw error
		}
	}

	public async updateServerTimeoutRPC(serverName: string, timeout: number): Promise<McpServer[]> {
		try {
			// Validate timeout against schema
			const setConfigResult = BaseConfigSchema.shape.timeout.safeParse(timeout)
			if (!setConfigResult.success) {
				throw new Error(`Invalid timeout value: ${timeout}. Must be at minimum ${MIN_MCP_TIMEOUT_SECONDS} seconds.`)
			}

			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)

			if (!config.mcpServers?.[serverName]) {
				throw new Error(`Server "${serverName}" not found in settings`)
			}

			config.mcpServers[serverName] = {
				...config.mcpServers[serverName],
				timeout,
			}

			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

			await this.updateServerConnectionsRPC(config.mcpServers)

			const serverOrder = Object.keys(config.mcpServers || {})
			return this.getSortedMcpServers(serverOrder)
		} catch (error) {
			console.error("Failed to update server timeout:", error)
			if (error instanceof Error) {
				console.error("Error details:", error.message, error.stack)
			}
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to update server timeout: ${error instanceof Error ? error.message : String(error)}`,
			})
			throw error
		}
	}

	/**
	 * Get and clear pending notifications
	 * @returns Array of pending notifications
	 */
	getPendingNotifications(): Array<{
		serverName: string
		level: string
		message: string
		timestamp: number
	}> {
		const notifications = [...this.pendingNotifications]
		this.pendingNotifications = []
		return notifications
	}

	/**
	 * Set the notification callback for real-time notifications
	 * @param callback Function to call when notifications arrive
	 */
	setNotificationCallback(callback: (serverName: string, level: string, message: string) => void): void {
		this.notificationCallback = callback
		//console.log("[MCP Debug] Notification callback set")
	}

	/**
	 * Clear the notification callback
	 */
	clearNotificationCallback(): void {
		this.notificationCallback = undefined
		//console.log("[MCP Debug] Notification callback cleared")
	}

	/**
	 * Initiates OAuth flow for a server
	 * Opens browser to authorization URL
	 */
	async initiateOAuth(serverName: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`No connection found for server: ${serverName}`)
		}

		// Extract serverUrl from config
		const config = JSON.parse(connection.server.config)
		const serverUrl = config.url
		if (!serverUrl) {
			throw new Error(`No URL found in config for server: ${serverName}`)
		}

		// Start OAuth flow - opens the SDK-generated authorization URL in browser
		await this.mcpOAuthManager.startOAuthFlow(serverName, serverUrl)
	}

	/**
	 * Completes OAuth flow after callback
	 * Validates state, calls finishAuth, and reconnects
	 */
	async completeOAuth(serverHash: string, code: string, state: string | null): Promise<void> {
		// Find the connection by matching the server hash
		const connection = this.connections.find((conn) => {
			const config = JSON.parse(conn.server.config)
			if (config.url) {
				const hash = getServerAuthHash(conn.server.name, config.url)
				return hash === serverHash
			}
			return false
		})

		if (!connection) {
			throw new Error(`No connection found for server hash: ${serverHash}`)
		}

		// Validate state for CSRF protection (if provided)
		if (state && !this.mcpOAuthManager.validateAndClearState(serverHash, state)) {
			throw new Error("Invalid OAuth state - possible CSRF attack")
		}

		// Call finishAuth on the transport - SDK handles token exchange
		// finishAuth is only available on SSE and StreamableHTTP transports
		if (connection.transport instanceof SSEClientTransport || connection.transport instanceof StreamableHTTPClientTransport) {
			await connection.transport.finishAuth(code)
		} else {
			throw new Error("OAuth is only supported for SSE and HTTP transports")
		}

		console.log(`[McpOAuth] Authentication completed for ${connection.server.name}`)

		// Update server status
		connection.server.oauthAuthStatus = "authenticated"
		connection.server.oauthRequired = true
		connection.server.error = ""

		// Restart connection to complete setup with authenticated transport
		await this.restartConnection(connection.server.name)
	}

	async dispose(): Promise<void> {
		this.removeAllFileWatchers()
		for (const connection of this.connections) {
			try {
				await this.deleteConnection(connection.server.name)
			} catch (error) {
				console.error(`Failed to close connection for ${connection.server.name}:`, error)
			}
		}
		this.connections = []
		if (this.settingsWatcher) {
			await this.settingsWatcher.close()
		}
	}
}
