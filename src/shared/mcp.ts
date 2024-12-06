export type McpServer = {
	name: string
	config: string
	status: "connected" | "connecting" | "disconnected"
	error?: string
	tools?: McpTool[]
	resources?: McpResource[]
}

export type McpTool = {
	name: string
	description?: string
	inputSchema?: object
}

export type McpResource = {
	uri: string
	name: string
	mimeType?: string
	description?: string
}
