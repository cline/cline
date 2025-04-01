import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import {
	CallToolResultSchema,
	ListResourcesResultSchema,
	ListResourceTemplatesResultSchema,
	ListToolsResultSchema,
	ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js"
import chokidar, { FSWatcher } from "chokidar"
import { setTimeout as setTimeoutPromise } from "node:timers/promises"
import deepEqual from "fast-deep-equal"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"
import { Controller } from "../../core/controller"
import {
	DEFAULT_MCP_TIMEOUT_SECONDS,
	McpMode,
	McpResource,
	McpResourceResponse,
	McpResourceTemplate,
	McpServer,
	McpTool,
	McpToolCallResponse,
	MIN_MCP_TIMEOUT_SECONDS,
	MCP_SOURCE_GLOBAL, // Import constants
	MCP_SOURCE_PROJECT, // Import constants
} from "../../shared/mcp"
import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { secondsToMs } from "../../utils/time"
import { GlobalFileNames, WorkspaceFileNames } from "../../core/storage/disk"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

// Default timeout for internal MCP data requests in milliseconds; is not the same as the user facing timeout stored as DEFAULT_MCP_TIMEOUT_SECONDS
const DEFAULT_REQUEST_TIMEOUT_MS = 5000

export type McpConnection = {
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport
}

export type McpTransportType = "stdio" | "sse"

export type McpServerConfig = z.infer<typeof ServerConfigSchema>

const AutoApproveSchema = z.array(z.string()).default([])

const BaseConfigSchema = z.object({
	autoApprove: AutoApproveSchema.optional(),
	disabled: z.boolean().optional(),
	timeout: z.number().min(MIN_MCP_TIMEOUT_SECONDS).optional().default(DEFAULT_MCP_TIMEOUT_SECONDS),
})

const SseConfigSchema = BaseConfigSchema.extend({
	url: z.string().url(),
}).transform((config) => ({
	...config,
	transportType: "sse" as const,
}))

const StdioConfigSchema = BaseConfigSchema.extend({
	command: z.string(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
}).transform((config) => ({
	...config,
	transportType: "stdio" as const,
}))

const ServerConfigSchema = z.union([StdioConfigSchema, SseConfigSchema])

const McpSettingsSchema = z.object({
	mcpServers: z.record(ServerConfigSchema).default({}), // Default to empty object
})
type McpSettings = z.infer<typeof McpSettingsSchema>

// Type for the merged server config including source
type MergedServerConfig = McpServerConfig & { source: typeof MCP_SOURCE_GLOBAL | typeof MCP_SOURCE_PROJECT } // Use constants in type

// --- McpHub Class ---
export class McpHub {
	private controllerRef: WeakRef<Controller>
	private disposables: vscode.Disposable[] = []
	// private settingsWatcher?: vscode.FileSystemWatcher // Replaced by onDidSaveTextDocument and chokidar
	private fileWatchers: Map<string, FSWatcher> = new Map() // Now includes local settings watcher
	connections: McpConnection[] = []
	isConnecting: boolean = false

	constructor(controller: Controller) {
		this.controllerRef = new WeakRef(controller)
		this.watchMcpSettingsFiles() // Renamed and updated function
		this.initializeMcpServers()
	}

	// --- Public Getters ---

	getServers(): McpServer[] {
		// Return servers sorted by original definition order (global first, then local)
		// Note: This sorting happens during notifyWebviewOfServerChanges now
		return this.connections.map((conn) => conn.server)
	}

	getMode(): McpMode {
		return vscode.workspace.getConfiguration("cline.mcp").get<McpMode>("mode", "full")
	}

	// --- File Path Helpers ---

	async getMcpServersPath(): Promise<string> {
		const provider = this.controllerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
		return mcpServersPath
	}

	async getGlobalMcpSettingsFilePath(): Promise<string> {
		const provider = this.controllerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const globalSettingsDir = await provider.ensureSettingsDirectoryExists()
		const mcpSettingsFilePath = path.join(globalSettingsDir, GlobalFileNames.mcpSettings)
		const fileExists = await fileExistsAtPath(mcpSettingsFilePath)
		if (!fileExists) {
			// Create default empty file if it doesn't exist
			await fs.writeFile(mcpSettingsFilePath, JSON.stringify({ mcpServers: {} }, null, 2))
			console.log("Created default global MCP settings file.")
		}
		return mcpSettingsFilePath
	}

	// Made public
	public getLocalMcpSettingsFilePath(): string | undefined {
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return undefined // No workspace open
		}
		// Use the first workspace folder as the project root
		const projectRoot = workspaceFolders[0].uri.fsPath
		return path.join(projectRoot, WorkspaceFileNames.mcpServers)
	}

	// --- Settings Reading and Merging ---

	// Reads and validates a specific settings file
	private async readAndValidateMcpSettingsFile(filePath: string): Promise<McpSettings | undefined> {
		try {
			// Use standard fs.readFile
			const content = await fs.readFile(filePath, "utf-8")

			let configJson: any
			try {
				configJson = JSON.parse(content)
			} catch (error) {
				vscode.window.showErrorMessage(`Invalid JSON format in ${path.basename(filePath)}. Please check the file.`)
				return undefined
			}

			const result = McpSettingsSchema.safeParse(configJson)
			if (!result.success) {
				console.error(`Invalid MCP settings schema in ${filePath}:`, result.error.errors)
				vscode.window.showErrorMessage(
					`Invalid MCP settings schema in ${path.basename(filePath)}. Please check the structure.`,
				)
				return undefined
			}
			return result.data
		} catch (error) {
			// Don't log error if file just doesn't exist (ENOENT)
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
				console.error(`Failed to read MCP settings file at ${filePath}:`, error)
			}
			return undefined
		}
	}

	// Merges global and local settings, prioritizing local
	private async loadAndMergeMcpSettings(): Promise<Record<string, MergedServerConfig>> {
		const globalSettingsPath = await this.getGlobalMcpSettingsFilePath()
		const localSettingsPath = this.getLocalMcpSettingsFilePath()

		const globalData = await this.readAndValidateMcpSettingsFile(globalSettingsPath)
		const localData = localSettingsPath ? await this.readAndValidateMcpSettingsFile(localSettingsPath) : undefined

		const globalServers = globalData?.mcpServers ?? {}
		const localServers = localData?.mcpServers ?? {}

		const mergedServers: Record<string, MergedServerConfig> = {}

		// Add global servers first
		for (const [name, config] of Object.entries(globalServers)) {
			mergedServers[name] = { ...config, source: MCP_SOURCE_GLOBAL } // Use constant
		}

		// Add/override with local servers
		for (const [name, config] of Object.entries(localServers)) {
			mergedServers[name] = { ...config, source: MCP_SOURCE_PROJECT } // Use constant
		}

		return mergedServers
	}

	// --- File Watching ---

	// Watches both global and local settings files
	private async watchMcpSettingsFiles(): Promise<void> {
		const globalSettingsPath = await this.getGlobalMcpSettingsFilePath()
		const localSettingsPath = this.getLocalMcpSettingsFilePath()

		const handleSettingsChange = async (changedPath: string | undefined) => {
			console.log(
				`Detected change relevant to MCP settings ${changedPath ? `(${path.basename(changedPath)})` : ""}. Reloading...`,
			)
			const mergedSettings = await this.loadAndMergeMcpSettings()
			// mergedSettings should always be defined unless both files fail validation catastrophically
			try {
				vscode.window.showInformationMessage("Updating MCP servers due to settings change...")
				await this.updateServerConnections(mergedSettings) // Pass the merged result
				vscode.window.showInformationMessage("MCP servers updated.")
			} catch (error) {
				console.error("Failed to process MCP settings change:", error)
				vscode.window.showErrorMessage("Error updating MCP servers after settings change.")
			}
		}

		// Watch global file saves (using VS Code API is fine here)
		this.disposables.push(
			vscode.workspace.onDidSaveTextDocument(async (document) => {
				if (arePathsEqual(document.uri.fsPath, globalSettingsPath)) {
					await handleSettingsChange(globalSettingsPath)
				}
			}),
		)

		// Watch local file changes (using chokidar for create/delete/change)
		if (localSettingsPath) {
			// Ensure directory exists before watching (though it should if workspace exists)
			try {
				// Watch the specific file path
				const watcher = chokidar.watch(localSettingsPath, {
					ignoreInitial: true,
					awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
					// If the file doesn't exist, chokidar might error or not watch correctly.
					// A more robust approach might involve watching the directory and filtering events,
					// but let's keep it simple first and watch the path directly.
					// Chokidar *should* handle file creation if watching the path.
				})

				watcher
					.on("add", () => handleSettingsChange(localSettingsPath))
					.on("change", () => handleSettingsChange(localSettingsPath))
					.on("unlink", () => handleSettingsChange(undefined)) // Pass undefined on unlink to signal reload needed
					.on("error", (error) => console.error(`Local MCP settings watcher error: ${error}`))

				this.fileWatchers.set("local_settings", watcher) // Use a distinct key
				console.log(`Watching local MCP settings file: ${localSettingsPath}`)
			} catch (watchError) {
				console.error(`Failed to set up watcher for local MCP settings at ${localSettingsPath}:`, watchError)
			}
		}
	}

	// --- Server Connection Management ---

	private async initializeMcpServers(): Promise<void> {
		const mergedSettings = await this.loadAndMergeMcpSettings()
		await this.updateServerConnections(mergedSettings)
	}

	// Accepts the merged config type
	private async connectToServer(name: string, config: MergedServerConfig): Promise<void> {
		// Remove existing connection if it exists
		this.connections = this.connections.filter((conn) => conn.server.name !== name)

		// Destructure config, excluding 'source' for storage in McpServer.config
		const { source, ...serverConfigToStore } = config

		try {
			// Each MCP server requires its own transport connection and has unique capabilities, configurations, and error handling. Having separate clients also allows proper scoping of resources/tools and independent server management like reconnection.
			const client = new Client(
				{
					name: "Cline",
					version: this.controllerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
				},
				{
					capabilities: {},
				},
			)

			let transport: StdioClientTransport | SSEClientTransport

			if (config.transportType === "sse") {
				transport = new SSEClientTransport(new URL(config.url), {})
			} else {
				transport = new StdioClientTransport({
					command: config.command,
					args: config.args,
					env: {
						...config.env,
						...(process.env.PATH ? { PATH: process.env.PATH } : {}),
						// ...(process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {}),
					},
					stderr: "pipe", // necessary for stderr to be available
				})
			}

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

			const connection: McpConnection = {
				server: {
					name,
					config: JSON.stringify(serverConfigToStore), // Store config without source
					status: "connecting",
					disabled: config.disabled,
					source: source, // Include the source
					timeout: config.timeout, // Ensure timeout is stored
				},
				client,
				transport,
			}
			this.connections.push(connection)

			if (config.transportType === "stdio") {
				// transport.stderr is only available after the process has been started. However we can't start it separately from the .connect() call because it also starts the transport. And we can't place this after the connect call since we need to capture the stderr stream before the connection is established, in order to capture errors during the connection process.
				// As a workaround, we start the transport ourselves, and then monkey-patch the start method to no-op so that .connect() doesn't try to start it again.
				await transport.start()
				const stderrStream = (transport as StdioClientTransport).stderr
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
			}

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
			const connection = this.connections.find((conn) => conn.server.name === serverName)

			if (!connection) {
				throw new Error(`No connection found for server: ${serverName}`)
			}

			const response = await connection.client.request({ method: "tools/list" }, ListToolsResultSchema, {
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			})

			// Get autoApprove settings from the *stored* config for this server
			const serverConfig: McpServerConfig = JSON.parse(connection.server.config)
			const autoApproveConfig = serverConfig.autoApprove || []

			// Mark tools as always allowed based on settings
			const tools = (response?.tools || []).map((tool) => ({
				...tool,
				autoApprove: autoApproveConfig.includes(tool.name),
			}))

			// console.log(`[MCP] Fetched tools for ${serverName}:`, tools)
			return tools
		} catch (error) {
			const connection = this.connections.find((conn) => conn.server.name === serverName) // Find connection within catch block
			console.error(`Failed to fetch tools for ${serverName}:`, error)
			if (connection) {
				// Check if connection exists before using it
				this.appendErrorMessage(
					connection,
					`Failed to fetch tools: ${error instanceof Error ? error.message : String(error)}`,
				)
				connection.server.status = "disconnected" // Assume disconnect if basic requests fail
				await this.notifyWebviewOfServerChanges()
			}
			return []
		}
	}

	private async fetchResourcesList(serverName: string): Promise<McpResource[]> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection || connection.server.status !== "connected") {
			return []
		}
		try {
			const response = await connection.client.request({ method: "resources/list" }, ListResourcesResultSchema, {
				timeout: DEFAULT_REQUEST_TIMEOUT_MS,
			})
			return response?.resources || []
		} catch (error) {
			// const connection = this.connections.find((conn) => conn.server.name === serverName) // Find connection within catch block
			// console.error(`Failed to fetch resources for ${serverName}:`, error)
			// if (connection) {
			// 	// Check if connection exists
			// 	this.appendErrorMessage(
			// 		connection,
			// 		`Failed to fetch resources: ${error instanceof Error ? error.message : String(error)}`,
			// 	)
			// 	connection.server.status = "disconnected"
			// 	await this.notifyWebviewOfServerChanges()
			// }
			return []
		}
	}

	private async fetchResourceTemplatesList(serverName: string): Promise<McpResourceTemplate[]> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection || connection.server.status !== "connected") {
			return []
		}
		try {
			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
				{
					timeout: DEFAULT_REQUEST_TIMEOUT_MS,
				},
			)
			return response?.resourceTemplates || []
		} catch (error) {
			// const connection = this.connections.find((conn) => conn.server.name === serverName) // Find connection within catch block
			// console.error(`Failed to fetch resource templates for ${serverName}:`, error)
			// if (connection) {
			// 	// Check if connection exists
			// 	this.appendErrorMessage(
			// 		connection,
			// 		`Failed to fetch resource templates: ${error instanceof Error ? error.message : String(error)}`,
			// 	)
			// 	connection.server.status = "disconnected"
			// 	await this.notifyWebviewOfServerChanges()
			//}
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
				// Log error but continue cleanup
				console.error(`Error closing transport/client for ${name}:`, error)
			}
			this.connections = this.connections.filter((conn) => conn.server.name !== name)
			// Remove associated build file watcher if it exists
			const buildWatcherKey = `build_${name}`
			const buildWatcher = this.fileWatchers.get(buildWatcherKey)
			if (buildWatcher) {
				await buildWatcher.close()
				this.fileWatchers.delete(buildWatcherKey)
			}
		}
	}

	// Accepts the merged server configurations
	async updateServerConnections(newServers: Record<string, MergedServerConfig>): Promise<void> {
		if (this.isConnecting) {
			console.warn("MCP Hub is already connecting/updating, skipping redundant update.")
			return
		}
		this.isConnecting = true
		console.log("Updating MCP server connections...")

		// Stop watching build files for servers that might be removed or changed
		this.removeAllBuildFileWatchers() // Keep settings watcher active

		const currentNames = new Set(this.connections.map((conn) => conn.server.name))
		const newNames = new Set(Object.keys(newServers))

		// Delete removed servers
		const serversToDelete = [...currentNames].filter((name) => !newNames.has(name))
		for (const name of serversToDelete) {
			await this.deleteConnection(name)
			console.log(`Deleted MCP server connection: ${name}`)
		}

		// Update or add servers
		const connectPromises: Promise<void>[] = []
		for (const [name, mergedConfig] of Object.entries(newServers)) {
			const currentConnection = this.connections.find((conn) => conn.server.name === name)
			const storedConfig = currentConnection ? JSON.parse(currentConnection.server.config) : undefined
			const { source, ...newConfigToStore } = mergedConfig // Prepare config without source for comparison/storage

			let needsUpdate = false
			if (!currentConnection) {
				needsUpdate = true // New server
				console.log(`New MCP server detected: ${name} (source: ${source})`)
			} else if (currentConnection.server.source !== source || !deepEqual(storedConfig, newConfigToStore)) {
				// Check if source OR the config (excluding source) changed
				needsUpdate = true // Config or source changed
				console.log(`MCP server config/source changed for: ${name} (new source: ${source})`)
			}

			if (needsUpdate) {
				// Connect (or reconnect)
				connectPromises.push(
					(async () => {
						if (currentConnection) {
							await this.deleteConnection(name) // Ensure old connection is fully closed first
						}
						// Setup build watcher *before* connecting if it's stdio
						if (mergedConfig.transportType === "stdio") {
							this.setupBuildFileWatcher(name, mergedConfig)
						}
						await this.connectToServer(name, mergedConfig) // Pass the full merged config
					})(),
				)
			} else {
				// Config and source are the same, just ensure build watcher is set up if needed
				if (mergedConfig.transportType === "stdio" && !this.fileWatchers.has(`build_${name}`)) {
					this.setupBuildFileWatcher(name, mergedConfig)
				}
			}
		}

		await Promise.allSettled(connectPromises) // Wait for all connections/reconnections

		console.log("Finished updating MCP server connections.")
		await this.notifyWebviewOfServerChanges() // Notify webview once after all updates
		this.isConnecting = false
	}

	// Watches the build output file for stdio servers
	private setupBuildFileWatcher(name: string, config: McpServerConfig) {
		// Accepts McpServerConfig (no source)
		if (config.transportType !== "stdio") {
			return
		}

		const buildWatcherKey = `build_${name}`
		if (this.fileWatchers.has(buildWatcherKey)) {
			return // Already watching
		}

		// Try to find the main script path in args (heuristic)
		// Use absolute paths if possible, otherwise assume relative to workspace root? Needs careful handling.
		// For now, let's assume args might contain a relative or absolute path.
		const scriptArg = config.args?.find((arg) => /\.(js|mjs|cjs)$/i.test(arg) && !arg.startsWith("-"))
		if (!scriptArg) {
			// console.warn(`Could not determine script path for watcher for server ${name}.`);
			return
		}

		// Resolve the path - this is tricky. Assume relative to workspace if not absolute.
		let absoluteScriptPath: string | undefined = undefined
		if (path.isAbsolute(scriptArg)) {
			absoluteScriptPath = scriptArg
		} else {
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (workspaceFolders && workspaceFolders.length > 0) {
				absoluteScriptPath = path.resolve(workspaceFolders[0].uri.fsPath, scriptArg)
			}
		}

		if (absoluteScriptPath) {
			// Check existence before watching? Chokidar might handle non-existent paths.
			try {
				const watcher = chokidar.watch(absoluteScriptPath, {
					ignoreInitial: true,
					awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
				})

				watcher.on("change", () => {
					console.log(`Detected build change for ${absoluteScriptPath}. Restarting server ${name}...`)
					// Debounce restarts slightly
					setTimeout(() => this.restartConnection(name), 500)
				})
				watcher.on("error", (error) => console.error(`Build file watcher error for ${name}: ${error}`))

				this.fileWatchers.set(buildWatcherKey, watcher)
				console.log(`Watching build file for ${name}: ${absoluteScriptPath}`)
			} catch (watchError) {
				console.error(`Failed to set up build file watcher for ${name} at ${absoluteScriptPath}:`, watchError)
			}
		} else {
			// console.warn(`Could not resolve absolute build script path for watcher for server ${name}.`);
		}
	}

	private removeAllBuildFileWatchers() {
		this.fileWatchers.forEach((watcher, key) => {
			if (key.startsWith("build_")) {
				watcher.close()
				this.fileWatchers.delete(key)
			}
		})
	}

	async restartConnection(serverName: string): Promise<void> {
		if (this.isConnecting) {
			console.warn(`Restart for ${serverName} skipped, hub is busy.`)
			return
		}
		this.isConnecting = true // Prevent concurrent restarts

		const currentConnection = this.connections.find((conn) => conn.server.name === serverName)
		if (currentConnection?.server.disabled) {
			console.log(`Skipping restart for disabled server: ${serverName}`)
			this.isConnecting = false
			return
		}

		vscode.window.showInformationMessage(`Restarting ${serverName} MCP server...`)

		// Get the latest merged config for this server
		const mergedSettings = await this.loadAndMergeMcpSettings()
		const config = mergedSettings[serverName] // This is MergedServerConfig

		if (!config) {
			console.error(`Config not found for server ${serverName} during restart attempt.`)
			vscode.window.showErrorMessage(`Failed to find config for ${serverName} to restart.`)
			this.isConnecting = false
			return
		}

		// Update status immediately for UI feedback
		if (currentConnection) {
			currentConnection.server.status = "connecting"
			currentConnection.server.error = "" // Clear previous errors
			await this.notifyWebviewOfServerChanges()
			await setTimeoutPromise(300) // Short delay for UI
		}

		try {
			await this.deleteConnection(serverName) // Close existing connection fully
			// Re-setup build watcher if needed
			if (config.transportType === "stdio") {
				this.setupBuildFileWatcher(serverName, config) // Pass config without source
			}
			await this.connectToServer(serverName, config) // Connect with the full merged config
			// Message shown by connectToServer on success/failure now
			// vscode.window.showInformationMessage(`${serverName} MCP server reconnected`)
		} catch (error) {
			// Error should be handled within connectToServer, just log here
			console.error(`Error during restartConnection process for ${serverName}:`, error)
			// vscode.window.showErrorMessage(`Failed to reconnect to ${serverName} MCP server`)
		} finally {
			await this.notifyWebviewOfServerChanges() // Ensure final state is sent
			this.isConnecting = false
		}
	}

	async restartAllEnabledConnections(): Promise<void> {
		vscode.window.showInformationMessage("Restarting all enabled MCP servers...")
		const enabledServers = this.connections.filter((conn) => !conn.server.disabled).map((conn) => conn.server.name)

		// Restart sequentially to avoid overwhelming system/network
		for (const serverName of enabledServers) {
			await this.restartConnection(serverName)
		}

		vscode.window.showInformationMessage("Finished restarting enabled MCP servers.")
	}

	// Sends the current state, respecting original definition order and including source
	private async notifyWebviewOfServerChanges(): Promise<void> {
		const mergedSettings = await this.loadAndMergeMcpSettings() // Get merged settings to determine order/source
		const serverOrder = Object.keys(mergedSettings) // Use merged keys for potential local-only servers

		const sortedConnections = [...this.connections].sort((a, b) => {
			const indexA = serverOrder.indexOf(a.server.name)
			const indexB = serverOrder.indexOf(b.server.name)
			// Handle cases where a connection might exist but isn't in the latest settings (should be rare)
			if (indexA === -1 && indexB === -1) {
				return a.server.name.localeCompare(b.server.name)
			}
			if (indexA === -1) {
				return 1
			}
			if (indexB === -1) {
				return -1
			}
			return indexA - indexB
		})

		// Ensure the 'source' is correctly set based on the latest merged settings
		const serversToSend = sortedConnections.map((conn) => {
			const mergedConfig = mergedSettings[conn.server.name]
			// Fallback logic: if somehow not in merged, keep existing source or default to global
			const source = mergedConfig?.source ?? conn.server.source ?? MCP_SOURCE_GLOBAL // Use constant
			return {
				...conn.server,
				source: source, // Ensure source is correctly typed here
			}
		})

		await this.controllerRef.deref()?.postMessageToWebview({
			type: "mcpServers",
			mcpServers: serversToSend,
		})
	}

	async sendLatestMcpServers() {
		await this.notifyWebviewOfServerChanges()
	}

	// --- Server Interaction ---

	async readResource(serverName: string, uri: string): Promise<McpResourceResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`No connection found for server: ${serverName}`)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}
		if (connection.server.status !== "connected") {
			throw new Error(`Server "${serverName}" is not connected`)
		}

		return await connection.client.request({ method: "resources/read", params: { uri } }, ReadResourceResultSchema)
	}

	async callTool(serverName: string, toolName: string, toolArguments?: Record<string, unknown>): Promise<McpToolCallResponse> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(
				`No connection found for server: ${serverName}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
			)
		}
		if (connection.server.disabled) {
			throw new Error(`Server "${serverName}" is disabled`)
		}
		if (connection.server.status !== "connected") {
			throw new Error(`Server "${serverName}" is not connected`)
		}

		const timeout = secondsToMs(connection.server.timeout ?? DEFAULT_MCP_TIMEOUT_SECONDS)

		return await connection.client.request(
			{ method: "tools/call", params: { name: toolName, arguments: toolArguments } },
			CallToolResultSchema,
			{ timeout },
		)
	}

	// --- Settings Modification Helpers ---

	// Helper to read, modify, and write a specific settings file
	private async modifySettingsFile(
		filePath: string,
		modification: (settings: McpSettings) => McpSettings | undefined,
	): Promise<boolean> {
		try {
			const currentSettings = await this.readAndValidateMcpSettingsFile(filePath)
			// If file doesn't exist or is invalid, create/use a default empty structure
			const settingsToModify = currentSettings ?? { mcpServers: {} }

			const modifiedSettings = modification(settingsToModify)

			if (modifiedSettings) {
				// Validate before writing
				const validationResult = McpSettingsSchema.safeParse(modifiedSettings)
				if (!validationResult.success) {
					console.error("Validation failed before writing settings:", validationResult.error)
					vscode.window.showErrorMessage("Internal error: Settings modification resulted in invalid schema.")
					return false
				}
				// Ensure the directory exists before writing (important for local file creation)
				await fs.mkdir(path.dirname(filePath), { recursive: true })
				await fs.writeFile(filePath, JSON.stringify(validationResult.data, null, 2))
				return true
			}
			return false // No modification was made
		} catch (error) {
			console.error(`Failed to modify settings file ${filePath}:`, error)
			vscode.window.showErrorMessage(`Failed to update settings in ${path.basename(filePath)}.`)
			return false
		}
	}

	// Determines which settings file (global or local) defines a server based on in-memory state
	private async _getServerSourceFilePath(serverName: string): Promise<string | undefined> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		const source = connection?.server.source ?? MCP_SOURCE_GLOBAL // Default to global if not found (e.g., during deletion)

		if (source === MCP_SOURCE_PROJECT) {
			// Use constant
			return this.getLocalMcpSettingsFilePath() // Might be undefined if no workspace
		} else {
			return await this.getGlobalMcpSettingsFilePath()
		}
	}

	// --- Public Methods for Server Management (Now use _getServerSourceFilePath) ---

	public async toggleServerDisabled(serverName: string, disabled: boolean): Promise<void> {
		const filePath = await this._getServerSourceFilePath(serverName)
		if (!filePath) {
			vscode.window.showErrorMessage(`Cannot toggle state for "${serverName}": Source file path not found.`)
			return
		}

		const success = await this.modifySettingsFile(filePath, (settings) => {
			if (settings.mcpServers?.[serverName]) {
				settings.mcpServers[serverName].disabled = disabled
				return settings
			}
			console.warn(`Server "${serverName}" not found in ${path.basename(filePath)} during toggle disable.`)
			return undefined // Server not found in this specific file
		})

		if (success) {
			// Update in-memory state immediately
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection) {
				connection.server.disabled = disabled
				// Update stored config string as well
				try {
					const config = JSON.parse(connection.server.config)
					config.disabled = disabled
					connection.server.config = JSON.stringify(config)
				} catch (e) {
					console.error("Failed to update stored config disabled state", e)
				}
				await this.notifyWebviewOfServerChanges() // Notify UI
			}
		} else {
			vscode.window.showErrorMessage(`Failed to update disabled state for "${serverName}" in ${path.basename(filePath)}.`)
		}
	}

	async toggleToolAutoApprove(serverName: string, toolNames: string[], shouldAllow: boolean): Promise<void> {
		const filePath = await this._getServerSourceFilePath(serverName)
		if (!filePath) {
			vscode.window.showErrorMessage(`Cannot update auto-approve for "${serverName}": Source file path not found.`)
			return
		}

		const success = await this.modifySettingsFile(filePath, (settings) => {
			const serverConf = settings.mcpServers?.[serverName]
			if (!serverConf) {
				console.warn(`Server "${serverName}" not found in ${path.basename(filePath)} during toggle auto-approve.`)
				return undefined
			}

			// Ensure autoApprove array exists and is mutable
			const autoApproveList = serverConf.autoApprove ? [...serverConf.autoApprove] : []

			let changed = false
			for (const toolName of toolNames) {
				const index = autoApproveList.indexOf(toolName)
				if (shouldAllow && index === -1) {
					autoApproveList.push(toolName)
					changed = true
				} else if (!shouldAllow && index !== -1) {
					autoApproveList.splice(index, 1)
					changed = true
				}
			}

			if (changed) {
				settings.mcpServers[serverName].autoApprove = autoApproveList
				return settings
			}
			return undefined // No changes needed
		})

		if (success) {
			// Update in-memory state
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection?.server.tools) {
				const currentAutoApprove = JSON.parse(connection.server.config).autoApprove ?? []
				// Update the autoApprove flag on the in-memory tools
				connection.server.tools = connection.server.tools.map((tool) => ({
					...tool,
					autoApprove: currentAutoApprove.includes(tool.name),
				}))
				// Update the stored config string
				try {
					const config = JSON.parse(connection.server.config)
					config.autoApprove = currentAutoApprove // Use the updated list
					connection.server.config = JSON.stringify(config)
				} catch (e) {
					console.error("Failed to update stored config autoApprove", e)
				}
				await this.notifyWebviewOfServerChanges()
			}
		} else {
			// Only show error if modification failed, not if no changes were needed
			// Need better error handling in modifySettingsFile to distinguish
		}
	}

	public async deleteServer(serverName: string): Promise<void> {
		const filePath = await this._getServerSourceFilePath(serverName)
		if (!filePath) {
			vscode.window.showWarningMessage(`Cannot delete: Server "${serverName}" not found in configuration.`)
			return
		}

		const success = await this.modifySettingsFile(filePath, (settings) => {
			if (settings.mcpServers?.[serverName]) {
				delete settings.mcpServers[serverName]
				return settings
			}
			return undefined // Server wasn't in this file
		})

		if (success) {
			vscode.window.showInformationMessage(`Deleted server "${serverName}" from ${path.basename(filePath)}.`)
			// File watcher should trigger reload. If it doesn't, manual reload might be needed.
			// For now, rely on the watcher.
		} else {
			vscode.window.showWarningMessage(`Server "${serverName}" not found in ${path.basename(filePath)} for deletion.`)
		}
	}

	public async addRemoteServer(serverName: string, serverUrl: string) {
		try {
			const globalSettingsPath = await this.getGlobalMcpSettingsFilePath()
			const settings = await this.readAndValidateMcpSettingsFile(globalSettingsPath)
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
				disabled: false,
				autoApprove: [],
			}

			// TS expects the server config to be a McpServerConfig, but we know it's valid
			// The issue is that the type is not having the transportType field added to it

			// ToDo: Add input types reflecting the non-transformed version
			settings.mcpServers[serverName] = serverConfig as unknown as McpServerConfig
			await fs.writeFile(globalSettingsPath, JSON.stringify(settings, null, 2))

			const mergedSettings = await this.loadAndMergeMcpSettings()
			// mergedSettings should always be defined unless both files fail validation catastrophically
			try {
				vscode.window.showInformationMessage("Updating MCP servers due to settings change...")
				await this.updateServerConnections(mergedSettings) // Pass the merged result
				vscode.window.showInformationMessage("MCP servers updated.")
			} catch (error) {
				console.error("Failed to process MCP settings change:", error)
				vscode.window.showErrorMessage("Error updating MCP servers after settings change.")
			}

			vscode.window.showInformationMessage(`Added and connected to ${serverName} MCP server`)
		} catch (error) {
			console.error("Failed to add remote MCP server:", error)

			vscode.window.showErrorMessage(
				`Failed to add remote MCP server: ${error instanceof Error ? error.message : String(error)}`,
			)

			throw error
		}
	}

	public async updateServerTimeout(serverName: string, timeout: number): Promise<void> {
		const validation = BaseConfigSchema.shape.timeout.safeParse(timeout)
		if (!validation.success) {
			vscode.window.showErrorMessage(`Invalid timeout value: ${validation.error.errors[0]?.message}`)
			return
		}

		const filePath = await this._getServerSourceFilePath(serverName)
		if (!filePath) {
			vscode.window.showErrorMessage(`Cannot update timeout for "${serverName}": Source file path not found.`)
			return
		}

		const success = await this.modifySettingsFile(filePath, (settings) => {
			if (settings.mcpServers?.[serverName]) {
				settings.mcpServers[serverName].timeout = timeout
				return settings
			}
			console.warn(`Server "${serverName}" not found in ${path.basename(filePath)} during update timeout.`)
			return undefined
		})

		if (success) {
			// Update in-memory state
			const connection = this.connections.find((conn) => conn.server.name === serverName)
			if (connection) {
				connection.server.timeout = timeout
				// Update stored config string
				try {
					const config = JSON.parse(connection.server.config)
					config.timeout = timeout
					connection.server.config = JSON.stringify(config)
				} catch (e) {
					console.error("Failed to update stored config timeout", e)
				}
				await this.notifyWebviewOfServerChanges()
			}
		} else {
			vscode.window.showErrorMessage(`Failed to update timeout for "${serverName}" in ${path.basename(filePath)}.`)
		}
	}

	// --- Disposal ---

	async dispose(): Promise<void> {
		console.log("Disposing McpHub...")
		this.fileWatchers.forEach((watcher) => watcher.close()) // Close all watchers
		this.fileWatchers.clear()
		// Close connections gracefully
		const closePromises = this.connections.map((conn) => this.deleteConnection(conn.server.name))
		await Promise.allSettled(closePromises)
		this.connections = []
		this.disposables.forEach((d) => d.dispose())
		console.log("McpHub disposed.")
	}
}

// Define handleSettingsChange globally or pass it around if needed within the class scope
// This needs careful handling if watchMcpSettingsFiles is async and relies on instance state
// For simplicity, let's assume handleSettingsChange can access `this` correctly when called by watchers.
// A potentially safer pattern involves binding or passing `this`.
// Let's refine the watcher setup slightly.

// Re-declare handleSettingsChange within the class scope or ensure proper binding if needed.
// The current implementation inside watchMcpSettingsFiles should work as it captures `this`.
