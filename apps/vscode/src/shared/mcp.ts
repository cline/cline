/**
 * Identifier for the MCP tools that are used in native tool calls,
 * where each tool name is the combination of the server name + identifier + tool name.
 * This enables to uniquely identify which MCP server a tool belongs to.
 *
 * The timeout constants are re-exported from @cline/shared so the extension,
 * CLI, and standalone core all resolve the same default and bounds.
 */
export {
	DEFAULT_MCP_TIMEOUT_SECONDS,
	MAX_MCP_TIMEOUT_SECONDS,
	MIN_MCP_TIMEOUT_SECONDS,
	resolveMcpTimeoutSeconds,
} from "@cline/shared"

export type McpServer = {
	name: string
	config: string
	status: "connected" | "connecting" | "disconnected"
	error?: string
	tools?: McpTool[]
	resources?: McpResource[]
	resourceTemplates?: McpResourceTemplate[]
	prompts?: McpPrompt[]
	disabled?: boolean
	timeout?: number
	oauthRequired?: boolean
	oauthAuthStatus?: McpOAuthAuthStatus
}

export type McpOAuthAuthStatus = "authenticated" | "unauthenticated" | "pending"

export type McpTool = {
	name: string
	description?: string
	inputSchema?: object
	autoApprove?: boolean
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

export type McpPromptArgument = {
	name: string
	description?: string
	required?: boolean
}

export type McpPrompt = {
	name: string
	title?: string
	description?: string
	arguments?: McpPromptArgument[]
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

export type McpViewTab = "addRemote" | "configure"
