import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import ReconnectingEventSource from "reconnecting-eventsource"
import {
	CallToolResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import chokidar, { FSWatcher } from "chokidar"
import delay from "delay"
import deepEqual from "fast-deep-equal"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"
import { t } from "../../i18n"

import { ClineProvider } from "../../core/webview/ClineProvider"
import { GlobalFileNames } from "../../shared/globalFileNames"
import {
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpServer,
	McpTool,
	McpToolCallResponse,
} from "../../shared/mcp"
import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"

export type McpConnection = {
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport
}

// Base configuration schema for common settings
const BaseConfigSchema = z.object({
	disabled: z.boolean().optional(),
	timeout: z.number().min(1).max(3600).optional().default(60),
	alwaysAllow: z.array(z.string()).default([]),
	watchPaths: z.array(z.string()).optional(), // paths to watch for changes and restart server
})

// Custom error messages for better user feedback
const typeErrorMessage = "Server type must be either 'stdio' or 'sse'"
const stdioFieldsErrorMessage =
	"For 'stdio' type servers, you must provide a 'command' field and can optionally include 'args' and 'env'"
const sseFieldsErrorMessage =
	"For 'sse' type servers, you must provide a 'url' field and can optionally include 'headers'"
const mixedFieldsErrorMessage =
	"Cannot mix 'stdio' and 'sse' fields. For 'stdio' use 'command', 'args', and 'env'. For 'sse' use 'url' and 'headers'"
const missingFieldsErrorMessage = "Server configuration must include either 'command' (for stdio) or 'url' (for sse)"

// Helper function to create a refined schema with better error messages
const createServerTypeSchema = () => {
	return z.union([
		// Stdio config (has command field)
		BaseConfigSchema.extend({
			type: z.enum(["stdio"]).optional(),
			command: z.string().min(1, "Command cannot be empty"),
			args: z.array(z.string()).optional(),
			env: z.record(z.string()).optional(),
			// Ensure no SSE fields are present
			url: z.undefined().optional(),
			headers: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "stdio" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "stdio", { message: typeErrorMessage }),
		// SSE config (has url field)
		BaseConfigSchema.extend({
			type: z.enum(["sse"]).optional(),
			url: z.string().url("URL must be a valid URL format"),
			headers: z.record(z.string()).optional(),
			// Ensure no stdio fields are present
			command: z.undefined().optional(),
			args: z.undefined().optional(),
			env: z.undefined().optional(),
		})
			.transform((data) => ({
				...data,
				type: "sse" as const,
			}))
			.refine((data) => data.type === undefined || data.type === "sse", { message: typeErrorMessage }),
	])
}

// Server configuration schema with automatic type inference and validation
export const ServerConfigSchema = createServerTypeSchema()

// Settings schema
const McpSettingsSchema = z.object({
	mcpServers: z.record(ServerConfigSchema),
})

export class McpHub {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private settingsWatcher?: vscode.FileSystemWatcher
	private fileWatchers: Map<string, FSWatcher[]> = new Map()
	private isDisposed: boolean = false
	connections: McpConnection[] = []
	isConnecting: boolean = false

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.watchMcpSettingsFile()
		this.initializeMcpServers()
	}

	/**
	 * Validates and normalizes server configuration
	 * @param config The server configuration to validate
	 * @param serverName Optional server name for error messages
	 * @returns The validated configuration
	 * @throws Error if the configuration is invalid
	 */
	private validateServerConfig(config: any, serverName?: string): z.infer<typeof ServerConfigSchema> {
		// Detect configuration issues before validation
		const hasStdioFields = config.command !== undefined
		const hasSseFields = config.url !== undefined

		// Check for mixed fields
		if (hasStdioFields && hasSseFields) {
			throw new Error(mixedFieldsErrorMessage)
		}

		// Check if it's a stdio or SSE config and add type if missing
		if (!config.type) {
			if (hasStdioFields) {
				config.type = "stdio"
			} else if (hasSseFields) {
				config.type = "sse"
			} else {
				throw new Error(missingFieldsErrorMessage)
			}
		} else if (config.type !== "stdio" && config.type !== "sse") {
			throw new Error(typeErrorMessage)
		}

		// Check for type/field mismatch
		if (config.type === "stdio" && !hasStdioFields) {
			throw new Error(stdioFieldsErrorMessage)
		}
		if (config.type === "sse" && !hasSseFields) {
			throw new Error(sseFieldsErrorMessage)
		}

		// Validate the config against the schema
		try {
			return ServerConfigSchema.parse(config)
		} catch (validationError) {
			if (validationError instanceof z.ZodError) {
				// Extract and format validation errors
				const errorMessages = validationError.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("; ")
				throw new Error(
					serverName
						? `Invalid configuration for server "${serverName}": ${errorMessages}`
						: `Invalid server configuration: ${errorMessages}`,
				)
			}
			throw validationError
		}
	}

	/**
	 * Formats and displays error messages to the user
	 * @param message The error message prefix
	 * @param error The error object
	 */
	private showErrorMessage(message: string, error: unknown): void {
		const errorMessage = error instanceof Error ? error.message : `${error}`
		console.error(`${message}:`, error)
		// if (vscode.window && typeof vscode.window.showErrorMessage === 'function') {
		// 	vscode.window.showErrorMessage(`${message}: ${errorMessage}`)
		// }
	}

	getServers(): McpServer[] {
		// Only return enabled servers
		return this.connections.filter((conn) => !conn.server.disabled).map((conn) => conn.server)
	}

	getAllServers(): McpServer[] {
		// Return all servers regardless of state
		return this.connections.map((conn) => conn.server)
	}

	async getMcpServersPath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
		return mcpServersPath
	}

	async getMcpSettingsFilePath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpSettingsFilePath = path.join(
			await provider.ensureSettingsDirectoryExists(),
			GlobalFileNames.mcpSettings,
		)
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

	private async watchMcpSettingsFile(): Promise<void> {
		const settingsPath = await this.getMcpSettingsFilePath()
		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument(async (document) => {
				if (arePathsEqual(document.uri.fsPath, settingsPath)) {
					const content = await fs.readFile(settingsPath, "utf-8")
					const errorMessage = t("common:errors.invalid_mcp_settings_format")
					let config: any
					try {
						config = JSON.parse(content)
					} catch (error) {
						vscode.window.showErrorMessage(errorMessage)
						return
					}
					const result = McpSettingsSchema.safeParse(config)
					if (!result.success) {
						const errorMessages = result.error.errors
							.map((err) => `${err.path.join(".")}: ${err.message}`)
							.join("\n")
						vscode.window.showErrorMessage(
							t("common:errors.invalid_mcp_settings_validation", { errorMessages }),
						)
						return
					}
					try {
						await this.updateServerConnections(result.data.mcpServers || {})
					} catch (error) {
						this.showErrorMessage("Failed to process MCP settings change", error)
					}
				}
			}),
		)
	}

	private async initializeMcpServers(): Promise<void> {
		try {
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			let config: any

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("common:errors.invalid_mcp_settings_syntax")
				console.error(errorMessage, parseError)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			// Validate the config using McpSettingsSchema
			const result = McpSettingsSchema.safeParse(config)
			if (result.success) {
				await this.updateServerConnections(result.data.mcpServers || {})
			} else {
				// Format validation errors for better user feedback
				const errorMessages = result.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				console.error("Invalid MCP settings format:", errorMessages)
				vscode.window.showErrorMessage(t("common:errors.invalid_mcp_settings_validation", { errorMessages }))

				// Still try to connect with the raw config, but show warnings
				try {
					await this.updateServerConnections(config.mcpServers || {})
				} catch (error) {
					this.showErrorMessage("Failed to initialize MCP servers with raw config", error)
				}
			}
		} catch (error) {
			this.showErrorMessage("Failed to initialize MCP servers", error)
		}
	}

	private async connectToServer(name: string, config: z.infer<typeof ServerConfigSchema>): Promise<void> {
		// Remove existing connection if it exists
		await this.deleteConnection(name)

		try {
			const client = new Client(
				{
					name: "Roo Code",
					version: this.providerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
				},
				{
					capabilities: {},
				},
			)

			let transport: StdioClientTransport | SSEClientTransport

			if (config.type === "stdio") {
				transport = new StdioClientTransport({
					command: config.command,
					args: config.args,
					env: {
						...config.env,
						...(process.env.PATH ? { PATH: process.env.PATH } : {}),
					},
					stderr: "pipe",
				})

				// Set up stdio specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}":`, error)
					const connection = this.connections.find((conn) => conn.server.name === name)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
				}

				transport.onclose = async () => {
					const connection = this.connections.find((conn) => conn.server.name === name)
					if (connection) {
						connection.server.status = "disconnected"
					}
					await this.notifyWebviewOfServerChanges()
				}

				// transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
				// As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
				await transport.start()
				const stderrStream = transport.stderr
				if (stderrStream) {
					stderrStream.on("data", async (data: Buffer) => {
						const output = data.toString()
						// Check if output contains INFO level log
						const isInfoLog = /INFO/i.test(output)

						if (isInfoLog) {
							// Log normal informational messages
							console.log(`Server "${name}" info:`, output)
						} else {
							// Treat as error log
							console.error(`Server "${name}" stderr:`, output)
							const connection = this.connections.find((conn) => conn.server.name === name)
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
				transport.start = async () => {} // No-op now, .connect() won't fail
			} else {
				// SSE connection
				const sseOptions = {
					requestInit: {
						headers: config.headers,
					},
				}
				// Configure ReconnectingEventSource options
				const reconnectingEventSourceOptions = {
					max_retry_time: 5000, // Maximum retry time in milliseconds
					withCredentials: config.headers?.["Authorization"] ? true : false, // Enable credentials if Authorization header exists
				}
				global.EventSource = ReconnectingEventSource
				transport = new SSEClientTransport(new URL(config.url), {
					...sseOptions,
					eventSourceInit: reconnectingEventSourceOptions,
				})

				// Set up SSE specific error handling
				transport.onerror = async (error) => {
					console.error(`Transport error for "${name}":`, error)
					const connection = this.connections.find((conn) => conn.server.name === name)
					if (connection) {
						connection.server.status = "disconnected"
						this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
					}
					await this.notifyWebviewOfServerChanges()
				}
			}

			const connection: McpConnection = {
				server: {
					name,
					config: JSON.stringify(config),
					status: "connecting",
					disabled: config.disabled,
				},
				client,
				transport,
			}
			this.connections.push(connection)

			// Connect (this will automatically start the transport)
			await client.connect(transport)
			connection.server.status = "connected"
			connection.server.error = ""

			// Initial fetch of tools and resources
			connection.server.tools = await this.fetchToolsList(name)
			connection.server.resources = await this.fetchResourcesList(name)
			connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name)
		} catch (error) {
			// Update status with error
			const connection = this.connections.find((conn) => conn.server.name === name)
			if (connection) {
				connection.server.status = "disconnected"
				this.appendErrorMessage(connection, error instanceof Error ? error.message : `${error}`)
			}
			throw error
		}
	}

	private appendErrorMessage(connection: McpConnection, error: string) {
		// Limit error message length to prevent excessive length
		const maxErrorLength = 1000
		const newError = connection.server.error ? `${connection.server.error}\n${error}` : error
		connection.server.error =
			newError.length > maxErrorLength
				? newError.substring(0, maxErrorLength) + "...(error message truncated)"
				: newError
	}

	private async fetchToolsList(serverName: string): Promise<McpTool[]> {
		try {
			const response = await this.connections
				.find((conn) => conn.server.name === serverName)
				?.client.request({ method: "tools/list" }, ListToolsResultSchema)

			// Get always allow settings
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)
			const alwaysAllowConfig = config.mcpServers[serverName]?.alwaysAllow || []

			// Mark tools as always allowed based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				alwaysAllow: alwaysAllowConfig.includes(tool.name),
			}))

			console.log(`[MCP] Fetched tools for ${serverName}:`, tools)
			return tools
		} catch (error) {
			// console.error(`Failed to fetch tools for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourcesList(serverName: string): Promise<McpResource[]> {
		try {
			const response = await this.connections
				.find((conn) => conn.server.name === serverName)
				?.client.request({ method: "resources/list" }, ListResourcesResultSchema)
			return response?.resources || []
		} catch (error) {
			// console.error(`Failed to fetch resources for ${serverName}:`, error)
			return []
		}
	}

	private async fetchResourceTemplatesList(serverName: string): Promise<McpResourceTemplate[]> {
		try {
			const response = await this.connections
				.find((conn) => conn.server.name === serverName)
				?.client.request({ method: "resources/templates/list" }, ListResourceTemplatesResultSchema)
			return response?.resourceTemplates || []
		} catch (error) {
			// console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}

	async deleteConnection(name: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === name)
		if (connection) {
			try {
				await connection.transport.close()
				await connection.client.close()
			} catch (error) {
				console.error(`Failed to close transport for ${name}:`, error)
			}
			this.connections = this.connections.filter((conn) => conn.server.name !== name)
		}
	}

	async updateServerConnections(newServers: Record<string, any>): Promise<void> {
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

			// Validate and transform the config
			let validatedConfig: z.infer<typeof ServerConfigSchema>
			try {
				validatedConfig = this.validateServerConfig(config, name)
			} catch (error) {
				this.showErrorMessage(`Invalid configuration for MCP server "${name}"`, error)
				continue
			}

			if (!currentConnection) {
				// New server
				try {
					this.setupFileWatcher(name, validatedConfig)
					await this.connectToServer(name, validatedConfig)
				} catch (error) {
					this.showErrorMessage(`Failed to connect to new MCP server ${name}`, error)
				}
			} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed config
				try {
					this.setupFileWatcher(name, validatedConfig)
					await this.deleteConnection(name)
					await this.connectToServer(name, validatedConfig)
					console.log(`Reconnected MCP server with updated config: ${name}`)
				} catch (error) {
					this.showErrorMessage(`Failed to reconnect MCP server ${name}`, error)
				}
			}
			// If server exists with same config, do nothing
		}
		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	private setupFileWatcher(name: string, config: z.infer<typeof ServerConfigSchema>) {
		// Initialize an empty array for this server if it doesn't exist
		if (!this.fileWatchers.has(name)) {
			this.fileWatchers.set(name, [])
		}

		const watchers = this.fileWatchers.get(name) || []

		// Only stdio type has args
		if (config.type === "stdio") {
			// Setup watchers for custom watchPaths if defined
			if (config.watchPaths && config.watchPaths.length > 0) {
				console.log(`Setting up custom path watchers for ${name} MCP server...`)
				const watchPathsWatcher = chokidar.watch(config.watchPaths, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true,
				})

				watchPathsWatcher.on("change", async (changedPath) => {
					console.log(`Detected change in custom path ${changedPath}. Restarting server ${name}...`)
					try {
						await this.restartConnection(name)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${changedPath}:`, error)
					}
				})

				watchers.push(watchPathsWatcher)
			}

			// Also setup the fallback build/index.js watcher if applicable
			const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
			if (filePath) {
				console.log(`Setting up build/index.js watcher for ${name} MCP server...`)
				// we use chokidar instead of onDidSaveTextDocument because it doesn't require the file to be open in the editor
				const indexJsWatcher = chokidar.watch(filePath, {
					// persistent: true,
					// ignoreInitial: true,
					// awaitWriteFinish: true, // This helps with atomic writes
				})

				indexJsWatcher.on("change", async () => {
					console.log(`Detected change in ${filePath}. Restarting server ${name}...`)
					try {
						await this.restartConnection(name)
					} catch (error) {
						console.error(`Failed to restart server ${name} after change in ${filePath}:`, error)
					}
				})

				watchers.push(indexJsWatcher)
			}

			// Update the fileWatchers map with all watchers for this server
			if (watchers.length > 0) {
				this.fileWatchers.set(name, watchers)
			}
		}
	}

	private removeAllFileWatchers() {
		this.fileWatchers.forEach((watchers) => watchers.forEach((watcher) => watcher.close()))
		this.fileWatchers.clear()
	}

	async restartConnection(serverName: string): Promise<void> {
		this.isConnecting = true
		const provider = this.providerRef.deref()
		if (!provider) {
			return
		}

		// Get existing connection and update its status
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		const config = connection?.server.config
		if (config) {
			vscode.window.showInformationMessage(t("common:info.mcp_server_restarting", { serverName }))
			connection.server.status = "connecting"
			connection.server.error = ""
			await this.notifyWebviewOfServerChanges()
			await delay(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName)
				// Parse the config to validate it
				const parsedConfig = JSON.parse(config)
				try {
					// Validate the config
					const validatedConfig = this.validateServerConfig(parsedConfig, serverName)

					// Try to connect again using validated config
					await this.connectToServer(serverName, validatedConfig)
					vscode.window.showInformationMessage(t("common:info.mcp_server_connected", { serverName }))
				} catch (validationError) {
					this.showErrorMessage(`Invalid configuration for MCP server "${serverName}"`, validationError)
				}
			} catch (error) {
				this.showErrorMessage(`Failed to restart ${serverName} MCP server connection`, error)
			}
		}

		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	private async notifyWebviewOfServerChanges(): Promise<void> {
		// servers should always be sorted in the order they are defined in the settings file
		const settingsPath = await this.getMcpSettingsFilePath()
		const content = await fs.readFile(settingsPath, "utf-8")
		const config = JSON.parse(content)
		const serverOrder = Object.keys(config.mcpServers || {})
		await this.providerRef.deref()?.postMessageToWebview({
			type: "mcpServers",
			mcpServers: [...this.connections]
				.sort((a, b) => {
					const indexA = serverOrder.indexOf(a.server.name)
					const indexB = serverOrder.indexOf(b.server.name)
					return indexA - indexB
				})
				.map((connection) => connection.server),
		})
	}

	public async toggleServerDisabled(serverName: string, disabled: boolean): Promise<void> {
		let settingsPath: string
		try {
			settingsPath = await this.getMcpSettingsFilePath()

			// Ensure the settings file exists and is accessible
			try {
				await fs.access(settingsPath)
			} catch (error) {
				console.error("Settings file not accessible:", error)
				throw new Error("Settings file not accessible")
			}
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)

			// Validate the config structure
			if (!config || typeof config !== "object") {
				throw new Error("Invalid config structure")
			}

			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			if (config.mcpServers[serverName]) {
				// Create a new server config object to ensure clean structure
				const serverConfig = {
					...config.mcpServers[serverName],
					disabled,
				}

				// Ensure required fields exist
				if (!serverConfig.alwaysAllow) {
					serverConfig.alwaysAllow = []
				}

				config.mcpServers[serverName] = serverConfig

				// Write the entire config back
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}

				await fs.writeFile(settingsPath, JSON.stringify(updatedConfig, null, 2))

				const connection = this.connections.find((conn) => conn.server.name === serverName)
				if (connection) {
					try {
						connection.server.disabled = disabled

						// Only refresh capabilities if connected
						if (connection.server.status === "connected") {
							connection.server.tools = await this.fetchToolsList(serverName)
							connection.server.resources = await this.fetchResourcesList(serverName)
							connection.server.resourceTemplates = await this.fetchResourceTemplatesList(serverName)
						}
					} catch (error) {
						console.error(`Failed to refresh capabilities for ${serverName}:`, error)
					}
				}

				await this.notifyWebviewOfServerChanges()
			}
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} state`, error)
			throw error
		}
	}

	public async updateServerTimeout(serverName: string, timeout: number): Promise<void> {
		let settingsPath: string
		try {
			settingsPath = await this.getMcpSettingsFilePath()

			// Ensure the settings file exists and is accessible
			try {
				await fs.access(settingsPath)
			} catch (error) {
				console.error("Settings file not accessible:", error)
				throw new Error("Settings file not accessible")
			}
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)

			// Validate the config structure
			if (!config || typeof config !== "object") {
				throw new Error("Invalid config structure")
			}

			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			if (config.mcpServers[serverName]) {
				// Create a new server config object to ensure clean structure
				const serverConfig = {
					...config.mcpServers[serverName],
					timeout,
				}

				config.mcpServers[serverName] = serverConfig

				// Write the entire config back
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}

				await fs.writeFile(settingsPath, JSON.stringify(updatedConfig, null, 2))
				await this.notifyWebviewOfServerChanges()
			}
		} catch (error) {
			this.showErrorMessage(`Failed to update server ${serverName} timeout settings`, error)
			throw error
		}
	}

	public async deleteServer(serverName: string): Promise<void> {
		try {
			const settingsPath = await this.getMcpSettingsFilePath()

			// Ensure the settings file exists and is accessible
			try {
				await fs.access(settingsPath)
			} catch (error) {
				throw new Error("Settings file not accessible")
			}

			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)

			// Validate the config structure
			if (!config || typeof config !== "object") {
				throw new Error("Invalid config structure")
			}

			if (!config.mcpServers || typeof config.mcpServers !== "object") {
				config.mcpServers = {}
			}

			// Remove the server from the settings
			if (config.mcpServers[serverName]) {
				delete config.mcpServers[serverName]

				// Write the entire config back
				const updatedConfig = {
					mcpServers: config.mcpServers,
				}

				await fs.writeFile(settingsPath, JSON.stringify(updatedConfig, null, 2))

				// Update server connections
				await this.updateServerConnections(config.mcpServers)

				vscode.window.showInformationMessage(t("common:info.mcp_server_deleted", { serverName }))
			} else {
				vscode.window.showWarningMessage(t("common:info.mcp_server_not_found", { serverName }))
			}
		} catch (error) {
			this.showErrorMessage(`Failed to delete MCP server ${serverName}`, error)
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
		toolArguments?: Record<string, unknown>,
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

		let timeout: number
		try {
			const parsedConfig = ServerConfigSchema.parse(JSON.parse(connection.server.config))
			timeout = (parsedConfig.timeout ?? 60) * 1000
		} catch (error) {
			console.error("Failed to parse server config for timeout:", error)
			// Default to 60 seconds if parsing fails
			timeout = 60 * 1000
		}

		return await connection.client.request(
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
	}

	async toggleToolAlwaysAllow(serverName: string, toolName: string, shouldAllow: boolean): Promise<void> {
		try {
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)

			// Initialize alwaysAllow if it doesn't exist
			if (!config.mcpServers[serverName].alwaysAllow) {
				config.mcpServers[serverName].alwaysAllow = []
			}

			const alwaysAllow = config.mcpServers[serverName].alwaysAllow
			const toolIndex = alwaysAllow.indexOf(toolName)

			if (shouldAllow && toolIndex === -1) {
				// Add tool to always allow list
				alwaysAllow.push(toolName)
			} else if (!shouldAllow && toolIndex !== -1) {
				// Remove tool from always allow list
				alwaysAllow.splice(toolIndex, 1)
			}

			// Write updated config back to file
			await fs.writeFile(settingsPath, JSON.stringify(config, null, 2))

			// Update the tools list to reflect the change
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection) {
				connection.server.tools = await this.fetchToolsList(serverName)
				await this.notifyWebviewOfServerChanges()
			}
		} catch (error) {
			this.showErrorMessage(`Failed to update always allow settings for tool ${toolName}`, error)
			throw error // Re-throw to ensure the error is properly handled
		}
	}

	async dispose(): Promise<void> {
		this.isDisposed = true
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
			this.settingsWatcher.dispose()
		}
		this.disposables.forEach((d) => d.dispose())
	}
}
