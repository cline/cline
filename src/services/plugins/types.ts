/**
 * Cline Plugin System Type Definitions
 * 
 * These types define the contract between Cline and plugin extensions.
 * All interfaces must remain stable for backward compatibility.
 */

/**
 * Core plugin interface that all Cline plugin extensions must implement.
 * Plugins are VS Code extensions that declare Cline as a dependency and
 * register during their activation.
 */
export interface ClinePlugin {
	/** Unique identifier for the plugin (typically the extension ID) */
	readonly id: string

	/** Human-readable display name */
	readonly name: string

	/** Semantic version string (e.g., "1.0.0") */
	readonly version: string

	/** Optional description of the plugin's purpose */
	readonly description?: string

	/**
	 * Get all capabilities/tools provided by this plugin.
	 * Called during registration and when capabilities need to be refreshed.
	 * 
	 * @returns Promise resolving to array of capability definitions
	 */
	getCapabilities(): Promise<PluginCapability[]>

	/**
	 * Execute a specific capability with the given parameters.
	 * Cline calls this when the LLM requests to use a plugin tool.
	 * 
	 * @param capabilityName - Name of the capability to execute
	 * @param parameters - Parameters passed from the LLM
	 * @param context - Limited execution context with safe services
	 * @returns Promise resolving to the capability's result
	 * @throws Error if execution fails (will be caught and handled by Cline)
	 */
	executeCapability(
		capabilityName: string,
		parameters: Record<string, any>,
		context: PluginContext
	): Promise<any>

	/**
	 * Optional cleanup method called when plugin is unregistered.
	 * Use this to dispose of resources, close connections, etc.
	 */
	dispose?(): Promise<void>
}

/**
 * Definition of a single capability/tool provided by a plugin.
 * Each capability becomes a tool that the LLM can use.
 */
export interface PluginCapability {
	/** Unique name within this plugin (e.g., "getPythonEnvironment") */
	name: string

	/** Description of what this capability does (shown to LLM) */
	description: string

	/** Parameter definitions for this capability */
	parameters: ParameterDefinition[]

	/** Optional description of what this capability returns */
	returns?: string

	/**
	 * Optional guidance for the LLM on when and how to use this capability.
	 * Use this to provide context, examples, and best practices.
	 */
	prompt?: string

	/**
	 * Optional usage examples to help the LLM understand when to use this capability.
	 * Each example should be a brief scenario description.
	 */
	examples?: string[]
}

/**
 * Definition of a parameter for a plugin capability.
 * Used to validate inputs and inform the LLM about expected parameters.
 */
export interface ParameterDefinition {
	/** Parameter name */
	name: string

	/** Parameter type */
	type: "string" | "number" | "boolean" | "object" | "array"

	/** Whether this parameter is required */
	required: boolean

	/** Optional description of the parameter */
	description?: string

	/** Optional default value if parameter is not provided */
	defaultValue?: any
}

/**
 * Limited execution context provided to plugins.
 * Provides safe, controlled access to services without exposing
 * internal Cline state or VS Code APIs.
 */
export interface PluginContext {
	/** Unique identifier for the current task */
	taskId: string

	/** Current task mode (plan or act) */
	taskMode: "plan" | "act"

	/** Current working directory for the task */
	workingDirectory: string

	/** Scoped logger for plugin output */
	logger: PluginLogger

	/** Plugin-specific key-value storage */
	storage: PluginStorage

	/** Rate-limited HTTP client for external requests */
	http: PluginHttpClient

	/**
	 * Send a notification message to the user.
	 * Use sparingly - messages appear in the chat interface.
	 * 
	 * @param message - Message to display to the user
	 */
	notify(message: string): void

	/**
	 * Request text input from the user.
	 * This will pause execution until the user responds.
	 * 
	 * @param prompt - Prompt to show the user
	 * @returns Promise resolving to the user's input
	 */
	requestInput(prompt: string): Promise<string>
}

/**
 * Scoped logging interface for plugins.
 * Logs are associated with the plugin ID and included in task history.
 */
export interface PluginLogger {
	/**
	 * Log debug information (verbose logging).
	 * Only shown when debug mode is enabled.
	 */
	debug(message: string, data?: any): void

	/** Log informational messages */
	info(message: string, data?: any): void

	/** Log warning messages */
	warn(message: string, data?: any): void

	/** Log error messages */
	error(message: string, data?: any): void
}

/**
 * Plugin-scoped storage interface.
 * Each plugin has isolated storage that persists across sessions.
 * Storage is scoped by plugin ID.
 */
export interface PluginStorage {
	/**
	 * Get a value from storage.
	 * 
	 * @param key - Storage key
	 * @returns Promise resolving to the stored value or undefined
	 */
	get<T>(key: string): Promise<T | undefined>

	/**
	 * Set a value in storage.
	 * 
	 * @param key - Storage key
	 * @param value - Value to store (must be JSON-serializable)
	 */
	set<T>(key: string, value: T): Promise<void>

	/**
	 * Delete a value from storage.
	 * 
	 * @param key - Storage key
	 */
	delete(key: string): Promise<void>

	/**
	 * Clear all storage for this plugin.
	 * Use with caution - this cannot be undone.
	 */
	clear(): Promise<void>
}

/**
 * Rate-limited HTTP client for plugins.
 * Prevents plugins from making excessive external requests.
 */
export interface PluginHttpClient {
	/**
	 * Make a GET request.
	 * 
	 * @param url - URL to request
	 * @param options - Optional request configuration
	 * @returns Promise resolving to the response
	 */
	get(url: string, options?: RequestOptions): Promise<HttpResponse>

	/**
	 * Make a POST request.
	 * 
	 * @param url - URL to request
	 * @param data - Data to send in request body
	 * @param options - Optional request configuration
	 * @returns Promise resolving to the response
	 */
	post(url: string, data?: any, options?: RequestOptions): Promise<HttpResponse>
}

/**
 * Configuration options for HTTP requests.
 */
export interface RequestOptions {
	/** HTTP headers to include in the request */
	headers?: Record<string, string>

	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number
}

/**
 * HTTP response from the plugin HTTP client.
 */
export interface HttpResponse {
	/** HTTP status code */
	status: number

	/** Response data (parsed JSON if applicable) */
	data: any

	/** Response headers */
	headers: Record<string, string>
}

/**
 * API exported by Cline for plugin registration.
 * Plugin extensions access this via the Cline extension's exports.
 */
export interface ClinePluginAPI {
	/**
	 * Register a plugin with Cline.
	 * Must be called during the plugin extension's activation.
	 * 
	 * @param plugin - Plugin instance to register
	 * @throws Error if registration fails or plugin ID conflicts
	 */
	registerPlugin(plugin: ClinePlugin): Promise<void>

	/**
	 * Unregister a previously registered plugin.
	 * Should be called during plugin extension's deactivation.
	 * 
	 * @param pluginId - ID of the plugin to unregister
	 */
	unregisterPlugin(pluginId: string): Promise<void>
}

/**
 * Internal type representing a registered plugin with metadata.
 * Not exposed to plugin extensions.
 */
export interface RegisteredPlugin {
	/** The plugin instance */
	plugin: ClinePlugin

	/** ID of the VS Code extension that registered this plugin */
	extensionId: string

	/** Cached capabilities map (name -> capability) */
	capabilities: Map<string, PluginCapability>

	/** Whether the plugin is currently active and usable */
	isActive: boolean

	/** Last error message if plugin has failed */
	lastError?: string

	/** Timestamp of last successful capability execution */
	lastExecutionTime?: number
}

/**
 * Options for executing a plugin capability.
 * Internal type used by PluginHub.
 */
export interface PluginExecutionOptions {
	/** Maximum execution time in milliseconds */
	timeout?: number

	/** Whether to retry on transient failures */
	retryOnFailure?: boolean
}

/**
 * Result of a plugin capability execution.
 * Internal type used by PluginHub and ToolHandler.
 */
export interface PluginExecutionResult {
	/** Whether execution succeeded */
	success: boolean

	/** Result data if successful */
	data?: any

	/** Error message if failed */
	error?: string

	/** Execution duration in milliseconds */
	duration: number

	/** Plugin ID that executed */
	pluginId: string

	/** Capability name that was executed */
	capabilityName: string
}
