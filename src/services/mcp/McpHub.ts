import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
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
import { ClineProvider, GlobalFileNames } from "../../core/webview/ClineProvider"
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
	transport: StdioClientTransport
}

// StdioServerParameters
const AlwaysAllowSchema = z.array(z.string()).default([])

const StdioConfigSchema = z.object({
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
	alwaysAllow: AlwaysAllowSchema.optional(),
	disabled: z.boolean().optional(),
})

const McpSettingsSchema = z.object({
	mcpServers: z.record(StdioConfigSchema),
})

export class McpHub {
	private providerRef: WeakRef<ClineProvider>
	private disposables: vscode.Disposable[] = []
	private settingsWatcher?: vscode.FileSystemWatcher
	private fileWatchers: Map<string, FSWatcher> = new Map()
	connections: McpConnection[] = []
	isConnecting: boolean = false

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.watchMcpSettingsFile()
		this.initializeMcpServers()
	}

	getServers(): McpServer[] {
		// Only return enabled servers
		return this.connections.filter((conn) => !conn.server.disabled).map((conn) => conn.server)
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
					const errorMessage =
						"Invalid MCP settings format. Please ensure your settings follow the correct JSON format."
					let config: any
					try {
						config = JSON.parse(content)
					} catch (error) {
						vscode.window.showErrorMessage(errorMessage)
						return
					}
					const result = McpSettingsSchema.safeParse(config)
					if (!result.success) {
						vscode.window.showErrorMessage(errorMessage)
						return
					}
					try {
						await this.updateServerConnections(result.data.mcpServers || {})
					} catch (error) {
						console.error("Failed to process MCP settings change:", error)
					}
				}
			}),
		)
	}

	private async initializeMcpServers(): Promise<void> {
		try {
			const settingsPath = await this.getMcpSettingsFilePath()
			const content = await fs.readFile(settingsPath, "utf-8")
			const config = JSON.parse(content)
			await this.updateServerConnections(config.mcpServers || {})
		} catch (error) {
			console.error("Failed to initialize MCP servers:", error)
		}
	}

	private async connectToServer(name: string, config: StdioServerParameters): Promise<void> {
		// Remove existing connection if it exists (should never happen, the connection should be deleted beforehand)
		this.connections = this.connections.filter((conn) => conn.server.name !== name)

		try {
			// Each MCP server requires its own transport connection and has unique capabilities, configurations, and error handling. Having separate clients also allows proper scoping of resources/tools and independent server management like reconnection.
			const client = new Client(
				{
					name: "Cline",
					version: this.providerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
				},
				{
					capabilities: {},
				},
			)

			const transport = new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: {
					...config.env,
					...(process.env.PATH ? { PATH: process.env.PATH } : {}),
					// ...(process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {}),
				},
				stderr: "pipe", // necessary for stderr to be available
			})

			transport.onerror = async (error) => {
				console.error(`Transport error for "${name}":`, error)
				const connection = this.connections.find((conn) => conn.server.name === name)
				if (connection) {
					connection.server.status = "disconnected"
					this.appendErrorMessage(connection, error.message)
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

			// If the config is invalid, show an error
			if (!StdioConfigSchema.safeParse(config).success) {
				console.error(`Invalid config for "${name}": missing or invalid parameters`)
				const connection: McpConnection = {
					server: {
						name,
						config: JSON.stringify(config),
						status: "disconnected",
						error: "Invalid config: missing or invalid parameters",
					},
					client,
					transport,
				}
				this.connections.push(connection)
				return
			}

			// valid schema
			const parsedConfig = StdioConfigSchema.parse(config)
			const connection: McpConnection = {
				server: {
					name,
					config: JSON.stringify(config),
					status: "connecting",
					disabled: parsedConfig.disabled,
				},
				client,
				transport,
			}
			this.connections.push(connection)

			// transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
			// As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
			await transport.start()
			const stderrStream = transport.stderr
			if (stderrStream) {
				stderrStream.on("data", async (data: Buffer) => {
					const errorOutput = data.toString()
					console.error(`Server "${name}" stderr:`, errorOutput)
					const connection = this.connections.find((conn) => conn.server.name === name)
					if (connection) {
						// NOTE: we do not set server status to "disconnected" because stderr logs do not necessarily mean the server crashed or disconnected, it could just be informational. In fact when the server first starts up, it immediately logs "<name> server running on stdio" to stderr.
						this.appendErrorMessage(connection, errorOutput)
						// Only need to update webview right away if it's already disconnected
						if (connection.server.status === "disconnected") {
							await this.notifyWebviewOfServerChanges()
						}
					}
				})
			} else {
				console.error(`No stderr stream for ${name}`)
			}
			transport.start = async () => {} // No-op now, .connect() won't fail

			// // Set up notification handlers
			// client.setNotificationHandler(
			// 	// @ts-ignore-next-line
			// 	{ method: "notifications/tools/list_changed" },
			// 	async () => {
			// 		console.log(`Tools changed for server: ${name}`)
			// 		connection.server.tools = await this.fetchTools(name)
			// 		await this.notifyWebviewOfServerChanges()
			// 	},
			// )

			// client.setNotificationHandler(
			// 	// @ts-ignore-next-line
			// 	{ method: "notifications/resources/list_changed" },
			// 	async () => {
			// 		console.log(`Resources changed for server: ${name}`)
			// 		connection.server.resources = await this.fetchResources(name)
			// 		connection.server.resourceTemplates = await this.fetchResourceTemplates(name)
			// 		await this.notifyWebviewOfServerChanges()
			// 	},
			// )

			// Connect
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
				// connection.client.removeNotificationHandler("notifications/tools/list_changed")
				// connection.client.removeNotificationHandler("notifications/resources/list_changed")
				// connection.client.removeNotificationHandler("notifications/stderr")
				// connection.client.removeNotificationHandler("notifications/stderr")
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

			if (!currentConnection) {
				// New server
				try {
					this.setupFileWatcher(name, config)
					await this.connectToServer(name, config)
				} catch (error) {
					console.error(`Failed to connect to new MCP server ${name}:`, error)
				}
			} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed config
				try {
					this.setupFileWatcher(name, config)
					await this.deleteConnection(name)
					await this.connectToServer(name, config)
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

	private setupFileWatcher(name: string, config: any) {
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
			vscode.window.showInformationMessage(`Restarting ${serverName} MCP server...`)
			connection.server.status = "connecting"
			connection.server.error = ""
			await this.notifyWebviewOfServerChanges()
			await delay(500) // artificial delay to show user that server is restarting
			try {
				await this.deleteConnection(serverName)
				// Try to connect again using existing config
				await this.connectToServer(serverName, JSON.parse(config))
				vscode.window.showInformationMessage(`${serverName} MCP server connected`)
			} catch (error) {
				console.error(`Failed to restart connection for ${serverName}:`, error)
				vscode.window.showErrorMessage(`Failed to connect to ${serverName} MCP server`)
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

	// Public methods for server management

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
			console.error("Failed to update server disabled state:", error)
			if (error instanceof Error) {
				console.error("Error details:", error.message, error.stack)
			}
			vscode.window.showErrorMessage(
				`Failed to update server state: ${error instanceof Error ? error.message : String(error)}`,
			)
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

		return await connection.client.request(
			{
				method: "tools/call",
				params: {
					name: toolName,
					arguments: toolArguments,
				},
			},
			CallToolResultSchema,
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
			console.error("Failed to update always allow settings:", error)
			vscode.window.showErrorMessage("Failed to update always allow settings")
			throw error // Re-throw to ensure the error is properly handled
		}
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
			this.settingsWatcher.dispose()
		}
		this.disposables.forEach((d) => d.dispose())
	}
}
