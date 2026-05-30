export const DEFAULT_MCP_TIMEOUT_SECONDS = 300 // 5 min default; AI-Hydro tools (TWI, model training) need 3-10 min
export const MIN_MCP_TIMEOUT_SECONDS = 1
export type McpMode = "full" | "server-use-only" | "off"

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

export type McpTool = {
	name: string
	description?: string
	inputSchema?: object
	autoApprove?: boolean
	/**
	 * MCP `_meta` field — arbitrary server-side metadata about the tool.
	 * AI-Hydro uses `{ tier: 1|2|3, domain: string }` for tier-based
	 * context filtering (Wave 1.5).
	 */
	_meta?: Record<string, any>
}

export type McpResource = {
	uri: string
	name: string
	mimeType?: string
	description?: string
}

export type McpResourceTemplate = {
	uriTemplate: string
	name: string
	description?: string
	mimeType?: string
}

export type McpResourceResponse = {
	_meta?: Record<string, any>
	contents: Array<{
		uri: string
		mimeType?: string
		text?: string
		blob?: string
	}>
}

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
				type: "audio"
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
		| {
				type: "resource_link"
				uri: string
				name?: string
				description?: string
				mimeType?: string
		  }
	>
	isError?: boolean
}

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
	authorUrl?: string
	citation?: string
	citationUrl?: string
	aiHydroInstalls?: number
	aiHydroStars?: number
	starredByClient?: boolean
}

export interface McpMarketplaceCatalog {
	items: McpMarketplaceItem[]
}

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

export type McpViewTab = "marketplace" | "addRemote" | "configure"
