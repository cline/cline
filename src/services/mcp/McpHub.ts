import * as vscode from "vscode"
import { ModelInfo } from "../../shared/api"
import { IClineProvider } from "../../core/webview/IClineProvider"

export interface McpServer {
	name: string
	tools: McpTool[]
	resources: McpResource[]
	resourceTemplates: McpResourceTemplate[]
}

export interface McpTool {
	name: string
	description: string
	inputSchema: any
	autoApprove: boolean
}

export interface McpResource {
	uri: string
	name: string
	description?: string
	mimeType?: string
}

export interface McpResourceTemplate {
	uriTemplate: string
	name: string
	description?: string
	mimeType?: string
}

export interface McpConnection {
	server: McpServer
	callTool: (toolName: string, args: any) => Promise<any>
	readResource: (uri: string) => Promise<any>
}

export class McpHub {
	private connections: McpConnection[] = []
	private isConnecting: boolean = false
	private mode: "off" | "limited" | "full" = "off"

	constructor(private provider: IClineProvider) {
		// Initialize MCP hub
	}

	dispose() {
		// Clean up connections
		this.connections = []
		this.isConnecting = false
		this.mode = "off"
	}

	getMode(): "off" | "limited" | "full" {
		return this.mode
	}

	getMcpServersPath(): Promise<string> {
		return Promise.resolve("/Users/ocasta/Documents/Cline/MCP")
	}

	async callTool(serverName: string, toolName: string, args: any): Promise<any> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`Server ${serverName} not found`)
		}
		return connection.callTool(toolName, args)
	}

	async readResource(serverName: string, uri: string): Promise<any> {
		const connection = this.connections.find((conn) => conn.server.name === serverName)
		if (!connection) {
			throw new Error(`Server ${serverName} not found`)
		}
		return connection.readResource(uri)
	}

	getConnections(): McpConnection[] {
		return this.connections
	}

	isConnected(serverName: string): boolean {
		return this.connections.some((conn) => conn.server.name === serverName)
	}
}
