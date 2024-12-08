import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
import {
	ListResourcesResultSchema,
	ListToolsResultSchema,
	ListResourceTemplatesResultSchema,
	ReadResourceResultSchema,
	CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
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
const StdioConfigSchema = z.object({
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
})

const McpSettingsSchema = z.object({
	mcpServers: z.record(StdioConfigSchema),
})

export class McpHub {
	private providerRef: WeakRef<ClineProvider>
	private settingsWatcher?: vscode.FileSystemWatcher
	private disposables: vscode.Disposable[] = []
	connections: McpConnection[] = []
	isConnecting: boolean = false

	constructor(provider: ClineProvider) {
		this.providerRef = new WeakRef(provider)
		this.watchMcpSettingsFile()
		this.initializeMcpServers()
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
						vscode.window.showInformationMessage("Updating MCP servers...")
						await this.updateServerConnections(result.data.mcpServers || {})
						vscode.window.showInformationMessage("MCP servers updated")
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
		// Remove existing connection if it exists
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
			})

			transport.onerror = (error) => {
				console.error(`Transport error for "${name}":`, error)
				const connection = this.connections.find((conn) => conn.server.name === name)
				if (connection) {
					connection.server.status = "disconnected"
					connection.server.error = error.message
				}
			}

			transport.onclose = () => {
				const connection = this.connections.find((conn) => conn.server.name === name)
				if (connection) {
					connection.server.status = "disconnected"
				}
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
				await this.notifyWebviewOfServerChanges()
				return
			}

			await client.connect(transport)
			const connection: McpConnection = {
				server: {
					name,
					config: JSON.stringify(config),
					status: "connecting",
				},
				client,
				transport,
			}
			this.connections.push(connection)
			connection.server.status = "connected"

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

			// Initial fetch of tools and resources
			connection.server.tools = await this.fetchToolsList(name)
			connection.server.resources = await this.fetchResourcesList(name)
			connection.server.resourceTemplates = await this.fetchResourceTemplatesList(name)

			await this.notifyWebviewOfServerChanges()
		} catch (error) {
			// Update status with error
			const connection = this.connections.find((conn) => conn.server.name === name)
			if (connection) {
				connection.server.status = "disconnected"
				connection.server.error = error instanceof Error ? error.message : String(error)
			}
			await this.notifyWebviewOfServerChanges()
			throw error
		}
	}

	private async fetchToolsList(serverName: string): Promise<McpTool[]> {
		try {
			const response = await this.connections
				.find((conn) => conn.server.name === serverName)
				?.client.request({ method: "tools/list" }, ListToolsResultSchema)
			return response?.tools || []
		} catch (error) {
			console.error(`Failed to fetch tools for ${serverName}:`, error)
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
			console.error(`Failed to fetch resources for ${serverName}:`, error)
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
			console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			return []
		}
	}

	async deleteConnection(name: string): Promise<void> {
		const connection = this.connections.find((conn) => conn.server.name === name)
		if (connection) {
			try {
				// connection.client.removeNotificationHandler("notifications/tools/list_changed")
				// connection.client.removeNotificationHandler("notifications/resources/list_changed")
				await connection.transport.close()
				await connection.client.close()
			} catch (error) {
				console.error(`Failed to close transport for ${name}:`, error)
			}
			this.connections = this.connections.filter((conn) => conn.server.name !== name)
			await this.notifyWebviewOfServerChanges()
		}
	}

	async updateServerConnections(newServers: Record<string, any>): Promise<void> {
		this.isConnecting = true
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
				// New server - connect
				try {
					await this.connectToServer(name, config)
				} catch (error) {
					console.error(`Failed to connect to new MCP server ${name}:`, error)
				}
			} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
				// Existing server with changed config - reconnect
				try {
					await this.deleteConnection(name)
					await this.connectToServer(name, config)
					console.log(`Reconnected MCP server with updated config: ${name}`)
				} catch (error) {
					console.error(`Failed to reconnect MCP server ${name}:`, error)
				}
			}
			// If server exists with same config, do nothing
		}
		this.isConnecting = false
	}

	async retryConnection(serverName: string): Promise<void> {
		this.isConnecting = true
		const provider = this.providerRef.deref()
		if (!provider) {
			return
		}

		// Get existing connection and update its status
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		const config = connection?.server.config
		if (config) {
			// Try to connect again using existing config
			await this.connectToServer(serverName, JSON.parse(config))
		}

		await this.notifyWebviewOfServerChanges()
		this.isConnecting = false
	}

	private async notifyWebviewOfServerChanges(): Promise<void> {
		await this.providerRef.deref()?.postMessageToWebview({
			type: "mcpServers",
			mcpServers: this.connections.map((connection) => connection.server),
		})
	}

	// Using server

	async readResource(serverName: string, uri: string): Promise<McpResourceResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`No connection found for server: ${serverName}`)
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
			throw new Error(`No connection found for server: ${serverName}`)
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

	async dispose(): Promise<void> {
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
