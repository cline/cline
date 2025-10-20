/**
 * Plugin Hub Service
 *
 * Central registry and lifecycle management for Cline plugins.
 * Handles discovery, registration, execution, and system prompt integration.
 */

import * as vscode from "vscode"
import { createPluginContext, PluginContextConfig } from "./PluginContext"
import { ClinePlugin, PluginCapability, PluginExecutionResult, RegisteredPlugin } from "./types"

/**
 * Central hub for managing Cline plugins
 */
export class PluginHub {
	private plugins: Map<string, RegisteredPlugin> = new Map()
	private readonly extensionContext: vscode.ExtensionContext

	constructor(extensionContext: vscode.ExtensionContext) {
		this.extensionContext = extensionContext
	}

	/**
	 * Discover and register plugins from VS Code extensions during Cline activation.
	 * Scans all installed extensions that declare Cline as a dependency.
	 */
	async discoverPlugins(): Promise<void> {
		const clineExtensionId = "saoudrizwan.claude-dev"

		// Get all extensions
		const allExtensions = vscode.extensions.all

		// Filter extensions that depend on Cline
		const dependentExtensions = allExtensions.filter((ext) => {
			const deps = ext.packageJSON?.extensionDependencies as string[] | undefined
			return deps?.includes(clineExtensionId)
		})

		console.log(`[PluginHub] Found ${dependentExtensions.length} extensions that depend on Cline`)

		// Note: Actual plugin registration happens when extensions call registerPlugin()
		// during their activation. This discovery phase just logs potential plugins.
		for (const ext of dependentExtensions) {
			if (!ext.isActive) {
				console.log(`[PluginHub] Extension ${ext.id} not yet active, will register when activated`)
			}
		}
	}

	/**
	 * Register a plugin with the hub.
	 * Called by plugin extensions through the Cline API.
	 *
	 * @param plugin - Plugin instance to register
	 * @param extensionId - ID of the extension registering the plugin
	 * @throws Error if plugin ID conflicts or registration fails
	 */
	async registerPlugin(plugin: ClinePlugin, extensionId: string): Promise<void> {
		// Validate plugin
		if (!plugin.id || typeof plugin.id !== "string") {
			throw new Error("Plugin must have a valid string ID")
		}

		if (!plugin.name || typeof plugin.name !== "string") {
			throw new Error("Plugin must have a valid string name")
		}

		if (!plugin.version || typeof plugin.version !== "string") {
			throw new Error("Plugin must have a valid string version")
		}

		if (typeof plugin.getCapabilities !== "function") {
			throw new Error("Plugin must implement getCapabilities() method")
		}

		if (typeof plugin.executeCapability !== "function") {
			throw new Error("Plugin must implement executeCapability() method")
		}

		// Check for ID conflicts
		if (this.plugins.has(plugin.id)) {
			throw new Error(`Plugin with ID '${plugin.id}' is already registered`)
		}

		console.log(`[PluginHub] Registering plugin: ${plugin.id} (${plugin.name} v${plugin.version})`)

		try {
			// Get capabilities from plugin
			const capabilities = await Promise.race([
				plugin.getCapabilities(),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Capability retrieval timeout")), 10000)),
			])

			// Validate capabilities
			this.validateCapabilities(capabilities, plugin.id)

			// Create capabilities map
			const capabilitiesMap = new Map<string, PluginCapability>()
			for (const capability of capabilities) {
				capabilitiesMap.set(capability.name, capability)
			}

			// Register plugin
			const registeredPlugin: RegisteredPlugin = {
				plugin,
				extensionId,
				capabilities: capabilitiesMap,
				isActive: true,
			}

			this.plugins.set(plugin.id, registeredPlugin)

			console.log(`[PluginHub] Successfully registered plugin '${plugin.id}' with ${capabilities.length} capabilities`)
		} catch (error) {
			console.error(`[PluginHub] Failed to register plugin '${plugin.id}':`, error)
			throw new Error(`Plugin registration failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * Unregister a plugin from the hub.
	 *
	 * @param pluginId - ID of plugin to unregister
	 */
	async unregisterPlugin(pluginId: string): Promise<void> {
		const registered = this.plugins.get(pluginId)

		if (!registered) {
			console.warn(`[PluginHub] Attempted to unregister unknown plugin: ${pluginId}`)
			return
		}

		console.log(`[PluginHub] Unregistering plugin: ${pluginId}`)

		try {
			// Call plugin's dispose method if it exists
			if (typeof registered.plugin.dispose === "function") {
				await Promise.race([
					registered.plugin.dispose(),
					new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Dispose timeout")), 5000)),
				])
			}
		} catch (error) {
			console.error(`[PluginHub] Error disposing plugin '${pluginId}':`, error)
			// Continue with unregistration even if dispose fails
		}

		this.plugins.delete(pluginId)
		console.log(`[PluginHub] Plugin '${pluginId}' unregistered`)
	}

	/**
	 * Execute a plugin capability with the given parameters.
	 *
	 * @param pluginId - ID of the plugin
	 * @param capabilityName - Name of the capability to execute
	 * @param parameters - Parameters to pass to the capability
	 * @param contextConfig - Configuration for creating the plugin context
	 * @returns Promise resolving to the execution result
	 */
	async executePluginCapability(
		pluginId: string,
		capabilityName: string,
		parameters: Record<string, any>,
		contextConfig: PluginContextConfig,
	): Promise<PluginExecutionResult> {
		const startTime = Date.now()

		try {
			// Get registered plugin
			const registered = this.plugins.get(pluginId)

			if (!registered) {
				return {
					success: false,
					error: `Plugin '${pluginId}' not found. Available plugins: ${Array.from(this.plugins.keys()).join(", ") || "none"}`,
					duration: Date.now() - startTime,
					pluginId,
					capabilityName,
				}
			}

			if (!registered.isActive) {
				return {
					success: false,
					error: `Plugin '${pluginId}' is not active${registered.lastError ? `: ${registered.lastError}` : ""}`,
					duration: Date.now() - startTime,
					pluginId,
					capabilityName,
				}
			}

			// Check capability exists
			const capability = registered.capabilities.get(capabilityName)

			if (!capability) {
				const availableCapabilities = Array.from(registered.capabilities.keys()).join(", ")
				return {
					success: false,
					error: `Capability '${capabilityName}' not found in plugin '${pluginId}'. Available capabilities: ${availableCapabilities}`,
					duration: Date.now() - startTime,
					pluginId,
					capabilityName,
				}
			}

			// Validate parameters
			const validationError = this.validateParameters(parameters, capability)
			if (validationError) {
				return {
					success: false,
					error: validationError,
					duration: Date.now() - startTime,
					pluginId,
					capabilityName,
				}
			}

			// Create plugin context with security boundaries
			const context = createPluginContext(contextConfig)

			console.log(`[PluginHub] Executing ${pluginId}.${capabilityName}`)

			// Execute capability with timeout
			const result = await Promise.race([
				registered.plugin.executeCapability(capabilityName, parameters, context),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error("Execution timeout after 60 seconds")), 60000),
				),
			])

			// Update last execution time
			registered.lastExecutionTime = Date.now()

			return {
				success: true,
				data: result,
				duration: Date.now() - startTime,
				pluginId,
				capabilityName,
			}
		} catch (error) {
			console.error(`[PluginHub] Error executing ${pluginId}.${capabilityName}:`, error)

			// Mark plugin as having an error
			const registered = this.plugins.get(pluginId)
			if (registered) {
				registered.lastError = error instanceof Error ? error.message : String(error)
			}

			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				duration: Date.now() - startTime,
				pluginId,
				capabilityName,
			}
		}
	}

	/**
	 * Get formatted plugin prompts for inclusion in system prompt.
	 * Returns a formatted string describing all available plugins and their capabilities.
	 */
	getPluginPrompts(): string {
		if (this.plugins.size === 0) {
			return ""
		}

		const sections: string[] = []

		for (const [pluginId, registered] of this.plugins.entries()) {
			if (!registered.isActive) {
				continue
			}

			const plugin = registered.plugin
			let section = `## ${plugin.name} (${pluginId})`

			if (plugin.description) {
				section += `\n${plugin.description}`
			}

			section += "\n\n### Available Capabilities:\n"

			for (const [capName, capability] of registered.capabilities.entries()) {
				section += `\n**${capName}**\n`
				section += `Description: ${capability.description}\n`

				if (capability.parameters.length > 0) {
					section += "\nParameters:\n"
					for (const param of capability.parameters) {
						const requiredStr = param.required ? "required" : "optional"
						const descStr = param.description ? `: ${param.description}` : ""
						section += `- ${param.name} (${param.type}, ${requiredStr})${descStr}\n`
					}
				} else {
					section += "\nNo parameters required.\n"
				}

				if (capability.returns) {
					section += `\nReturns: ${capability.returns}\n`
				}

				if (capability.prompt) {
					section += `\nUsage: ${capability.prompt}\n`
				}

				if (capability.examples && capability.examples.length > 0) {
					section += "\nExamples:\n"
					for (const example of capability.examples) {
						section += `- ${example}\n`
					}
				}
			}

			sections.push(section)
		}

		return sections.join("\n\n")
	}

	/**
	 * Get all plugin capabilities as an array.
	 * Useful for programmatic access to capabilities.
	 */
	getPluginCapabilities(): Array<{ pluginId: string; capability: PluginCapability }> {
		const capabilities: Array<{ pluginId: string; capability: PluginCapability }> = []

		for (const [pluginId, registered] of this.plugins.entries()) {
			if (!registered.isActive) {
				continue
			}

			for (const capability of registered.capabilities.values()) {
				capabilities.push({ pluginId, capability })
			}
		}

		return capabilities
	}

	/**
	 * Get count of registered plugins.
	 */
	getPluginCount(): number {
		return this.plugins.size
	}

	/**
	 * Get count of active plugins.
	 */
	getActivePluginCount(): number {
		return Array.from(this.plugins.values()).filter((p) => p.isActive).length
	}

	/**
	 * Get information about all registered plugins.
	 */
	getPlugins(): Array<{
		id: string
		name: string
		version: string
		description?: string
		extensionId: string
		isActive: boolean
		capabilityCount: number
		lastError?: string
	}> {
		return Array.from(this.plugins.values()).map((registered) => ({
			id: registered.plugin.id,
			name: registered.plugin.name,
			version: registered.plugin.version,
			description: registered.plugin.description,
			extensionId: registered.extensionId,
			isActive: registered.isActive,
			capabilityCount: registered.capabilities.size,
			lastError: registered.lastError,
		}))
	}

	/**
	 * Validate plugin capabilities array.
	 */
	private validateCapabilities(capabilities: PluginCapability[], pluginId: string): void {
		if (!Array.isArray(capabilities)) {
			throw new Error("getCapabilities() must return an array")
		}

		if (capabilities.length === 0) {
			throw new Error("Plugin must provide at least one capability")
		}

		const capabilityNames = new Set<string>()

		for (const capability of capabilities) {
			// Validate capability structure
			if (!capability.name || typeof capability.name !== "string") {
				throw new Error("Each capability must have a valid string name")
			}

			if (!capability.description || typeof capability.description !== "string") {
				throw new Error(`Capability '${capability.name}' must have a valid string description`)
			}

			if (!Array.isArray(capability.parameters)) {
				throw new Error(`Capability '${capability.name}' must have a parameters array`)
			}

			// Check for duplicate capability names
			if (capabilityNames.has(capability.name)) {
				throw new Error(`Duplicate capability name '${capability.name}' in plugin '${pluginId}'`)
			}
			capabilityNames.add(capability.name)

			// Validate parameters
			for (const param of capability.parameters) {
				if (!param.name || typeof param.name !== "string") {
					throw new Error(
						`Invalid parameter in capability '${capability.name}': parameter must have a valid string name`,
					)
				}

				const validTypes = ["string", "number", "boolean", "object", "array"]
				if (!validTypes.includes(param.type)) {
					throw new Error(
						`Invalid parameter type '${param.type}' for parameter '${param.name}' in capability '${capability.name}'`,
					)
				}

				if (typeof param.required !== "boolean") {
					throw new Error(
						`Parameter '${param.name}' in capability '${capability.name}' must have a boolean 'required' field`,
					)
				}
			}
		}
	}

	/**
	 * Validate parameters against capability definition.
	 */
	private validateParameters(parameters: Record<string, any>, capability: PluginCapability): string | null {
		// Check required parameters
		for (const paramDef of capability.parameters) {
			if (paramDef.required) {
				if (!(paramDef.name in parameters)) {
					return `Missing required parameter '${paramDef.name}'`
				}

				const value = parameters[paramDef.name]

				// Basic type checking
				const actualType = Array.isArray(value) ? "array" : typeof value
				const expectedType = paramDef.type

				if (actualType !== expectedType) {
					return `Parameter '${paramDef.name}' must be of type '${expectedType}', got '${actualType}'`
				}
			}
		}

		// Check for unexpected parameters
		const validParamNames = new Set(capability.parameters.map((p) => p.name))
		for (const paramName in parameters) {
			if (!validParamNames.has(paramName)) {
				return `Unexpected parameter '${paramName}'. Valid parameters: ${Array.from(validParamNames).join(", ")}`
			}
		}

		return null
	}

	/**
	 * Dispose of all plugins and clean up resources.
	 */
	async dispose(): Promise<void> {
		console.log("[PluginHub] Disposing all plugins")

		const pluginIds = Array.from(this.plugins.keys())

		for (const pluginId of pluginIds) {
			try {
				await this.unregisterPlugin(pluginId)
			} catch (error) {
				console.error(`[PluginHub] Error unregistering plugin '${pluginId}':`, error)
			}
		}

		this.plugins.clear()
	}
}
