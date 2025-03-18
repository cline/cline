/**
 * Model Control Protocol (MCP) type definitions and constants.
 *
 * This module defines types and constants for Cline's implementation of the Model Control Protocol,
 * which enables AI models to interact with external tools and resources. The MCP system
 * allows models to access information, execute commands, and utilize external services
 * in a controlled and secure manner.
 *
 * The types defined here cover:
 * - Server configuration and connection management
 * - Tool definitions and responses
 * - Resource access and templates
 * - Marketplace functionality for discovering and installing MCP extensions
 */

/**
 * Default timeout in seconds for MCP operations.
 * Matches Anthropic's default timeout in their MCP SDK.
 */
export const DEFAULT_MCP_TIMEOUT_SECONDS = 60 // matches Anthropic's default timeout in their MCP SDK

/**
 * Minimum allowed timeout in seconds for MCP operations.
 */
export const MIN_MCP_TIMEOUT_SECONDS = 1

/**
 * Operational modes for the Model Control Protocol.
 *
 * @property full - MCP is fully enabled with client and server capabilities
 * @property server-use-only - MCP is enabled but restricted to server-side operations only
 * @property off - MCP is completely disabled
 */
export type McpMode = "full" | "server-use-only" | "off"

/**
 * Configuration and status information for an MCP server.
 *
 * @property name - Display name of the server
 * @property config - Configuration string or path for the server
 * @property status - Current connection status of the server
 * @property error - Optional error message if the server has connection issues
 * @property tools - List of available tools this server provides
 * @property resources - List of available resources this server provides
 * @property resourceTemplates - List of resource templates for dynamic resource creation
 * @property disabled - Whether this server is currently disabled
 * @property timeout - Optional custom timeout in seconds for this server's operations
 */
export type McpServer = {
	name: string
	config: string
	status: "connected" | "connecting" | "disconnected"
	error?: string
	tools?: McpTool[]
	resources?: McpResource[]
	resourceTemplates?: McpResourceTemplate[]
	disabled?: boolean
	timeout?: number
}

/**
 * Definition of a tool that can be called by an AI model through MCP.
 *
 * @property name - Unique identifier for the tool
 * @property description - Human-readable description of the tool's purpose and functionality
 * @property inputSchema - JSON Schema defining the expected input parameters
 * @property autoApprove - Whether tool calls should be automatically approved without user confirmation
 */
export type McpTool = {
	name: string
	description?: string
	inputSchema?: object
	autoApprove?: boolean
}

/**
 * Definition of a resource that can be accessed by an AI model through MCP.
 *
 * @property uri - Unique identifier/path for the resource
 * @property name - Display name of the resource
 * @property mimeType - Optional MIME type of the resource content
 * @property description - Optional human-readable description of the resource
 */
export type McpResource = {
	uri: string
	name: string
	mimeType?: string
	description?: string
}

/**
 * Template for dynamically generating resources.
 *
 * @property uriTemplate - URI template with placeholders for dynamic generation
 * @property name - Display name of the template
 * @property description - Optional human-readable description of the template
 * @property mimeType - Optional MIME type of resources created from this template
 */
export type McpResourceTemplate = {
	uriTemplate: string
	name: string
	description?: string
	mimeType?: string
}

/**
 * Response from a resource access request.
 *
 * @property _meta - Optional metadata about the response
 * @property contents - Array of resource content objects
 * @property contents[].uri - URI of the returned resource
 * @property contents[].mimeType - Optional MIME type of the resource content
 * @property contents[].text - Optional text content of the resource
 * @property contents[].blob - Optional binary data as a base64-encoded string
 */
export type McpResourceResponse = {
	_meta?: Record<string, any>
	contents: Array<{
		uri: string
		mimeType?: string
		text?: string
		blob?: string
	}>
}

/**
 * Response from a tool call.
 *
 * @property _meta - Optional metadata about the response
 * @property content - Array of content items that may be text, images, or resources
 * @property isError - Optional flag indicating if the tool call resulted in an error
 */
export type McpToolCallResponse = {
	_meta?: Record<string, any>
	content: Array<
		| {
				type: "text"
				text: string
		  }
		| {
				type: "image"
				data: string
				mimeType: string
		  }
		| {
				type: "resource"
				resource: {
					uri: string
					mimeType?: string
					text?: string
					blob?: string
				}
		  }
	>
	isError?: boolean
}

/**
 * Information about an MCP extension available in the marketplace.
 *
 * @property mcpId - Unique identifier for the MCP extension
 * @property githubUrl - URL to the GitHub repository for the extension
 * @property name - Display name of the extension
 * @property author - Name of the extension author
 * @property description - Short description of the extension's functionality
 * @property codiconIcon - Codicon icon identifier for display in the UI
 * @property logoUrl - URL to the extension's logo image
 * @property category - Category the extension belongs to
 * @property tags - Array of tags for filtering and searching
 * @property requiresApiKey - Whether the extension requires an API key to function
 * @property readmeContent - Optional README content from the GitHub repository
 * @property llmsInstallationContent - Optional installation instructions for LLMs
 * @property isRecommended - Whether this extension is recommended/featured
 * @property githubStars - Number of GitHub stars for the repository
 * @property downloadCount - Number of times the extension has been downloaded
 * @property createdAt - ISO timestamp of when the extension was created
 * @property updatedAt - ISO timestamp of when the extension was last updated
 * @property lastGithubSync - ISO timestamp of the last synchronization with GitHub
 */
export interface McpMarketplaceItem {
	mcpId: string
	githubUrl: string
	name: string
	author: string
	description: string
	codiconIcon: string
	logoUrl: string
	category: string
	tags: string[]
	requiresApiKey: boolean
	readmeContent?: string
	llmsInstallationContent?: string
	isRecommended: boolean
	githubStars: number
	downloadCount: number
	createdAt: string
	updatedAt: string
	lastGithubSync: string
}

/**
 * Catalog of MCP extensions available in the marketplace.
 *
 * @property items - Array of marketplace items
 */
export interface McpMarketplaceCatalog {
	items: McpMarketplaceItem[]
}

/**
 * Response from downloading an MCP extension.
 *
 * @property mcpId - Unique identifier for the MCP extension
 * @property githubUrl - URL to the GitHub repository for the extension
 * @property name - Display name of the extension
 * @property author - Name of the extension author
 * @property description - Short description of the extension's functionality
 * @property readmeContent - README content from the GitHub repository
 * @property llmsInstallationContent - Installation instructions for LLMs
 * @property requiresApiKey - Whether the extension requires an API key to function
 */
export interface McpDownloadResponse {
	mcpId: string
	githubUrl: string
	name: string
	author: string
	description: string
	readmeContent: string
	llmsInstallationContent: string
	requiresApiKey: boolean
}
